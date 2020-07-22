# Koa Renderer

## Overview

This is a rendering engine so I can learn about parsing text files

### Templates

This uses a custom template rendering engine that uses streams to transform inputs into an output.
We are using `html` files and mustache-esque variables with support for `partials`.

Demo Usage:

```html
<!DOCTYPE html>
<html>
  <!-- We can use HTML tags -->
  <head>
    <!-- Or we can use mustache-esque templating -->
    <meta name="description" content="{{ description }}" />
    <!-- With built-in support for nested values -->
    <title>
      {{ meta.title }}
    </title>

    <!--
      We can also include other HTML files into this one.
      They will be parsed and resolved before inserting
    -->
    {{ partial('home-style.html' )}}
  </head>
  <body>
    <!--
      We can even iterate over values and render
      what we need during each iteration. Each
      iteration has access to `index`, which will
      be the index that that item is at in the iterator
    -->
    {{ forEach(users, 'users-card.html')}}
  </body>
</html>
```