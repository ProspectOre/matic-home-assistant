"""Make custom_components importable for tests and editable installs.

Home Assistant's loader requires a real package directory; a namespace
package resolves to a virtual setuptools finder path that the loader
cannot list.
"""
