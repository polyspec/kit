"""The public symbols of a Python package, for the language-parity check (scripts/kit/parity-symbols.mts).

    python3 -I python.py <package directory or module file>

Prints a JSON array of the public symbol ids, sorted, read with the standard library's ast; nothing is imported or run. A
module is named by its path from the parent of the entry, and a package by its __init__.py. A module or package whose name
starts with _ is private, except __init__. The public names of a module are its __all__ when it assigns one a list or tuple
of strings, else the names that it defines (def, class, assignment) and that do not start with _; an imported name belongs
to the module that defines it. The public methods of a public class are its def names that do not start with _. The ids are
<module>.<name> and <module>.<class>.<method>.

With --leaks it prints instead the public symbols whose signature or base classes name a private symbol, a name that starts with a
single _ (K307-1): the annotations of the parameters and the return of a public function, of a public method, and the bases of a
public class, as "<id> names the private <name>". A string annotation is read as the expression it holds.
"""

import ast
import contextlib
import json
import sys
from pathlib import Path


def module_name(path, base):
    parts = list(path.relative_to(base).with_suffix("").parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def private(path, base):
    return any(
        part.startswith("_") and part != "__init__.py"
        for part in path.relative_to(base).parts
    )


def declared_all(tree):
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "__all__"
            for target in node.targets
        ):
            if not isinstance(node.value, (ast.List, ast.Tuple)) or not all(
                isinstance(item, ast.Constant) and isinstance(item.value, str)
                for item in node.value.elts
            ):
                raise SystemExit("__all__ is no literal list or tuple of strings")
            return [item.value for item in node.value.elts]
    return None


def defined(tree):
    names = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names[node.name] = node
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            for target in (
                node.targets if isinstance(node, ast.Assign) else [node.target]
            ):
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
                if isinstance(
                    member, (ast.FunctionDef, ast.AsyncFunctionDef)
                ) and not member.name.startswith("_"):
                    found.append(f"{module}.{name}.{member.name}")
    return found


def is_private(name):
    return name.startswith("_") and not (name.startswith("__") and name.endswith("__"))


def names_in(node):
    """The names that the expression `node` refers to, a string annotation read as an expression."""
    if node is None:
        return []
    found = []
    for item in ast.walk(node):
        if isinstance(item, ast.Name):
            found.append(item.id)
        elif isinstance(item, ast.Attribute):
            found.append(item.attr)
        elif isinstance(item, ast.Constant) and isinstance(item.value, str):
            # A string constant that is no expression, such as a Literal value, names no symbol; a forward reference does.
            with contextlib.suppress(SyntaxError):
                found.extend(names_in(ast.parse(item.value, mode="eval")))
    return found


def signature_names(function):
    arguments = function.args
    every = arguments.posonlyargs + arguments.args + arguments.kwonlyargs
    every += [argument for argument in (arguments.vararg, arguments.kwarg) if argument]
    names = [name for argument in every for name in names_in(argument.annotation)]
    return names + names_in(function.returns)


def leaks(path, base):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    module = module_name(path, base)
    names = defined(tree)
    public = declared_all(tree)
    if public is None:
        public = [name for name in names if not name.startswith("_")]
    found = []
    for name in public:
        node = names.get(name)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            used = [(f"{module}.{name}", signature_names(node))]
        elif isinstance(node, ast.ClassDef):
            used = [(f"{module}.{name}", [n for base_class in node.bases for n in names_in(base_class)])]
            for member in node.body:
                if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)) and not member.name.startswith("_"):
                    used.append((f"{module}.{name}.{member.name}", signature_names(member)))
        else:
            used = []
        for symbol, referenced in used:
            found.extend(f"{symbol} names the private {n}" for n in dict.fromkeys(referenced) if is_private(n))
    return found


def main():
    if len(sys.argv) == 3 and sys.argv[2] == "--leaks":
        entry = Path(sys.argv[1]).resolve()
        if not entry.exists():
            raise SystemExit(f"{sys.argv[1]} does not exist")
        base = entry.parent
        files = sorted(entry.rglob("*.py")) if entry.is_dir() else [entry]
        print(json.dumps(sorted(leak for path in files if not private(path, base) for leak in leaks(path, base))))
        return
    if len(sys.argv) != 2:
        raise SystemExit("usage: python.py <package directory or module file> [--leaks]")
    entry = Path(sys.argv[1]).resolve()
    if not entry.exists():
        raise SystemExit(f"{sys.argv[1]} does not exist")
    base = entry.parent
    files = sorted(entry.rglob("*.py")) if entry.is_dir() else [entry]
    found = [
        symbol
        for path in files
        if not private(path, base)
        for symbol in symbols(path, base)
    ]
    print(json.dumps(sorted(found)))


main()
