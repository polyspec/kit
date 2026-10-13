"""The public symbols of a Python package, for the language-parity check (scripts/kit/parity-symbols.mts).

    python3 -I python.py <package directory or module file>

Prints a JSON array of the public symbol ids, sorted, read with the standard library's ast; nothing is imported or run. A
module is named by its path from the parent of the entry, and a package by its __init__.py. A module or package whose name
starts with _ is private, except __init__. The public names of a module are its __all__ when it assigns one a list or tuple
of strings, else the names that it defines (def, class, assignment) and that do not start with _; an imported name belongs
to the module that defines it. The public methods of a public class are its def names that do not start with _. The ids are
<module>.<name> and <module>.<class>.<method>.
"""

import ast
import json
import sys
from pathlib import Path


def module_name(path, base):
    parts = list(path.relative_to(base).with_suffix("").parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def private(path, base):
    return any(part.startswith("_") and part != "__init__.py" for part in path.relative_to(base).parts)


def declared_all(tree):
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "__all__" for target in node.targets):
            if not isinstance(node.value, (ast.List, ast.Tuple)) or not all(isinstance(item, ast.Constant) and isinstance(item.value, str) for item in node.value.elts):
                raise SystemExit("__all__ is no literal list or tuple of strings")
            return [item.value for item in node.value.elts]
    return None


def defined(tree):
    names = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names[node.name] = node
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            for target in node.targets if isinstance(node, ast.Assign) else [node.target]:
                if isinstance(target, ast.Name):
                    names[target.id] = node
    return names


def symbols(path, base):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    module = module_name(path, base)
    names = defined(tree)
    public = declared_all(tree)
    if public is None:
        public = [name for name in names if not name.startswith("_")]
    found = []
    for name in public:
        found.append(f"{module}.{name}")
        node = names.get(name)
        if isinstance(node, ast.ClassDef):
            for member in node.body:
                if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)) and not member.name.startswith("_"):
                    found.append(f"{module}.{name}.{member.name}")
    return found


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: python.py <package directory or module file>")
    entry = Path(sys.argv[1]).resolve()
    if not entry.exists():
        raise SystemExit(f"{sys.argv[1]} does not exist")
    base = entry.parent
    files = sorted(entry.rglob("*.py")) if entry.is_dir() else [entry]
    found = [symbol for path in files if not private(path, base) for symbol in symbols(path, base)]
    print(json.dumps(sorted(found)))


main()
