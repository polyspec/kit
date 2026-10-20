"""The skip and narrowing markers of Python test files, read from their syntax tree (`make test-markers-check`, K345).

    python3 -I python.py <file or - for standard input>...

Prints a JSON array with one entry per argument, in order: {"path", "markers", "error"}. A marker is a name of code (a
decorator, a call or an attribute), read with the standard library's ast, so a marker inside a string literal or a comment
is no marker. The markers are the dotted names that the text check named before (unittest.skip, pytest.mark.xfail,
pytest.skip, pytest.importorskip) and the method skipTest of a test case; each line keeps its first marker. A file that does
not parse has the error {"line", "message"} of its syntax error and no markers.
"""

import ast
import json
import re
import sys

# The dotted names of code that skip or narrow a test (K255, K315).
MARKER = re.compile(
    r"unittest\.skip(?:If|Unless)?|pytest\.mark\.(?:skip|skipif|xfail)|pytest\.skip|pytest\.importorskip"
)


def dotted(node):
    """The dotted name of a name or a chain of attributes, or None for any other expression."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = dotted(node.value)
        return None if base is None else f"{base}.{node.attr}"
    return None


def marker_of(node):
    """The marker that `node` is, or None."""
    if isinstance(node, ast.Attribute) and node.attr == "skipTest":
        return "skipTest"
    if isinstance(node, ast.Name) and node.id == "skipTest":
        return "skipTest"
    name = dotted(node)
    if name is not None and MARKER.fullmatch(name):
        return name
    return None


def markers(tree):
    """The markers of the tree: one per line, the first in the order of the columns."""
    first = {}
    for node in ast.walk(tree):
        marker = marker_of(node)
        if marker is None:
            continue
        if node.lineno not in first or node.col_offset < first[node.lineno][0]:
            first[node.lineno] = (node.col_offset, marker)
    return [
        {"line": line, "marker": marker} for line, (_, marker) in sorted(first.items())
    ]


def check(path):
    """The reading of the file `path`, or of the standard input for -."""
    if path == "-":
        source = sys.stdin.buffer.read()
    else:
        with open(path, "rb") as handle:
            source = handle.read()
    try:
        tree = ast.parse(source, filename=path)
    except SyntaxError as error:
        return {
            "path": path,
            "markers": [],
            "error": {"line": error.lineno or 1, "message": error.msg},
        }
    return {"path": path, "markers": markers(tree), "error": None}


if __name__ == "__main__":
    print(json.dumps([check(path) for path in sys.argv[1:]]))
