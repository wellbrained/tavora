# Checks before you publish

- Making a module zip tells you when the catalog won't take it, and a damaged screenshot is found before you upload.
- Names with emoji count as one character each, as the module file's schema says.
- Module addresses ending in .lan, .home or .corp are refused, since they only exist on a private network.
- A module that names a host with one of those endings in its manifest is now refused; no module in the catalog does.
