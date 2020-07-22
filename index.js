const fs = require('fs')
const path = require('path')
const stream = require('stream')
const R = require('ramda')

const postcss = require('postcss');
const htmlSytnax = require('postcss-html')({})

const presetEnv = require('postcss-preset-env')

const postcssPlugins = [
  presetEnv({
    stage: 0,
    browsers: ['last 2 versions'],
  }),
]

const linePostProcessor = R.composeP(
  source => postcss(postcssPlugins).process(source, { syntax: htmlSytnax, from: undefined })
)

const readFile = file_path => new Promise((res, rej) => fs.readFile(file_path, 'utf8', (err, data) => {
  if (err) {
    return rej(err)
  }

  res(data)
}))

const startsWith = value => R.compose(
  R.equals(0),
  R.indexOf(value)
)

const isPartialValue = startsWith(`partial('`)

const isIteratorValue = startsWith('forEach')

class TransformStream extends stream.Transform {
  constructor(data, args) {
    super()
    // How do we know we need to resolve a value?
    this.regexp = new RegExp(`${args.open_bracket}(.*?)${args.close_bracket}`)
    // What data goes along with this transformation?
    this.data = data
    // What are the arguments for resolving the request?
    this.args = args
    // What have we seen so far?
    this.partials = new Map()

    // How do we transform the value?
    this._transform = this._transform.bind(this)
  }

  // A partial value is one that is trying to
  // include some other template, such as a
  // component or the head
  async transformPartial(value) {
    // Let's get what name it is refering to
    // such as home.html or some/longer/path.html
    const partial_name = value.replace("partial('", '').slice(0, -2).trim()
    // Let's create the path
    const partial_path = path.resolve(this.args.partials, partial_name)

    // If we have the file
    const partial_file = await (this.partials.has(partial_path)
      // return the file
      ? this.partials.get(partial_path)
      // else await the reading of the contents
      : readFile(partial_path, 'utf8'))

    // If we haven't seen this before
    if (!this.partials.has(partial_path)) {
      // go ahead and set it
      this.partials.set(partial_path, partial_file)
    }

    // If we don't have anything to resolve,
    // let's return it
    if (!this.shouldBeTransformed(partial_file)) {
      return partial_file
    }

    // This partial has something we need to resolve!
    // Let's start breaking it up
    const lines = partial_file.split(/\n/)


    // Keep track of the transformations
    let result = ''

    // Transform each line
    for (const line of lines) {
      const value = await this.transformLine(line)
      /**
       * CODE OF INTEREST:
       * 
       * We are doing `\n` in order to preserve the
       * lines. If we do not do this, we are unable
       * to write JS how we want to
       */
      result += `${value}\n`
    }

    // Return to the caller the needed transformation
    return result
  }

  transformSimpleValue(value) {
    return R.path(value.split('.'), this.data)
  }

  async transformIteratorValue(value) {
    const inside_parens = value.replace('forEach', '').slice(1, -1)
    const [toIterateOver, partial_to_apply_to] = inside_parens.split(',').map(value => value.trim())
    const iterator = await this.transformSimpleValue(toIterateOver)

    let result = ''

    for (let i = 0; i < iterator.length; i++) {
      const value = iterator[i]

      this.old_data = this.data
      this.data = Object.assign({}, this.data, value, { index: i })

      result += await this.transformPartial(`partial(${partial_to_apply_to})`)
      this.data = this.old_data
      delete this.old_data
    }

    return result
  }

  async transformValue(value) {
    const transformer = R.cond([
      [isPartialValue, this.transformPartial.bind(this)],
      [isIteratorValue, this.transformIteratorValue.bind(this)],
      [R.T, this.transformSimpleValue.bind(this)]
    ])

    return transformer(value)
  }

  async transformLine(line) {
    // Let's keep track of the transformed values
    let new_line = line
    let matched
    // and while we have a match
    while (matched = this.regexp.exec(new_line)) {
      // break the match up
      const [matched_group, value_to_resolve] = matched
      // and replace it in the transformed string
      const value_to_replace = await this.transformValue(value_to_resolve.trim())

      // We assign the matched group with the given value
      new_line = new_line.replace(matched_group, value_to_replace)
    }

    return linePostProcessor(new_line)
  }

  shouldBeTransformed(file) {
    return this.regexp.test(file)
  }

  async transformFile(file) {
    // If there is nothing to transform
    // just return the file as-is
    if (!this.shouldBeTransformed(file)) {
      this.push(file)
      return
    }

    // We split it into lines
    const lines = file.split(/\n/)

    // For every line
    for (const line of lines) {
      // Let's keep track of the transformed values
      const new_line = await this.transformLine(line)
      // once we have transformed the line,
      // push that line to the stream
      this.push(`${new_line}\n`)
    }
  }

  // How we transform a template file
  // into a realized file
  async _transform(chunk, _, callback) {
    // We read it into memory
    const file = chunk.toString()
    await this.transformFile(file)

    // We are done and we can say
    // that the stream is closed
    callback()
  }
}

/**
 * 
 * @typedef {Object} ViewRendererConfig
 * 
 * @prop {string} open_bracket The string to match for opening
 * @prop {string} close_bracket The string to match for closing
 * @prop {string} root_dir The directory that holds the views
 * @prop {string} partials The directory that holds the partials. Defaults to rootDir/../partials
 * @prop {Object} default_values An object that holds default values to apply to every path
 */

/**
 * Creates a rendering engine that uses Streams
 * @param {ViewRendererConfig} config
 * @returns {import('koa').Middleware} Middleware function that creates the needed response
 */
module.exports = ({
  open_bracket = '{{',
  close_bracket = '}}',
  root_dir = 'views',
  partials = path.resolve(root_dir, '..', 'partials'),
  default_values = {
    meta: {
      title: '',
      description: '',
      author: '',
      keywords: []
    }
  }
} = {}) => (ctx, next) => {
  // When a route calls "ctx.render()"
  ctx.render = (entryFile, data) => {
    // Read the input file
    const readStream = fs.createReadStream(path.resolve(root_dir, entryFile))
    // Create Write Stream
    const transformStream = new TransformStream(Object.assign({}, default_values, data), {
      partials,
      open_bracket,
      close_bracket,
    })

    // Tell the client we are going to be sending
    // back some HTML file
    ctx.response.set("Content-Type", "text/html");
    // So that I feel special each time I render this
    ctx.response.set('X-Created-By', 'Blogger Custom Templates')

    // And pipe the reading of the file
    // through the transformer and to
    // the client
    ctx.body = readStream.pipe(transformStream)
  }

  // Let anyone else care about this now that
  // we have added the renderer to the request
  return next()
}