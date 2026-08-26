// Kotlin ships no grammar here, so it uses the C-family markers.
package com.example

/**
 * A widget.
 */
class Widget(val name: String) {
  fun render(): String {
    val prefix = "// not a comment"   // trailing
    return prefix + name
  }
}
