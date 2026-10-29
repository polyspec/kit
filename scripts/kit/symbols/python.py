"""The public symbols of a Python distribution, for the language-parity check (scripts/kit/parity-symbols.mts).

    <project>/.venv/bin/python -I python.py <distribution> [--leaks]

Prints a JSON array of the public symbol ids, sorted, read with the standard library's ast. The modules are the .py files of
the installed distribution, the file list (RECORD) of its non-editable install in the environment that the repository's own
install made, which its build backend selected; the reader installs nothing, discovers no module itself, and imports or runs
no product module. A distribution that is not installed fails with the error of importlib.metadata. A module is named by
its path in the environment's site-packages, and a package by its __init__.py. A module or package whose name starts with _
is private, except __init__. The public names of a module are its __all__ when it assigns one a list or tuple
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
from importlib import metadata
from pathlib import Path


def module_name(path, base):
    parts = list(path.relative_to(base).with_suffix("").parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def installed_files(name):
    """The site-packages folder of the distribution `name` and the .py files of its installed file list."""
    distribution = metadata.distribution(name)
    files = distribution.files
    if files is None:
        raise SystemExit(f"the distribution {name} has no installed file list (RECORD)")
    if any(
        file.name.startswith("__editable__") or file.suffix == ".pth" for file in files
    ):
        raise SystemExit(
            f"the distribution {name} is an editable install, whose file list holds no module; install it non-editable"
        )
    base = Path(distribution.locate_file("")).resolve()
    modules = sorted(
        base / file
        for file in files
        if file.suffix == ".py"
        and ".." not in file.parts
        and not file.parts[0].endswith((".dist-info", ".data"))
    )
    return base, modules


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


def public_names(path, base):
    """The module of `path`, its definitions by name, and its public names: those of __all__, else the names without _."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names = defined(tree)
    public = declared_all(tree)
    if public is None:
        public = [name for name in names if not name.startswith("_")]
    return module_name(path, base), names, public


def symbols(path, base):
    module, names, public = public_names(path, base)
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
    module, names, public = public_names(path, base)
    found = []
    for name in public:
        node = names.get(name)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            used = [(f"{module}.{name}", signature_names(node))]
        elif isinstance(node, ast.ClassDef):
            used = [
                (
                    f"{module}.{name}",
                    [n for base_class in node.bases for n in names_in(base_class)],
                )
            ]
            for member in node.body:
                if isinstance(
                    member, (ast.FunctionDef, ast.AsyncFunctionDef)
                ) and not member.name.startswith("_"):
                    used.append(
                        (f"{module}.{name}.{member.name}", signature_names(member))
                    )
        else:
            used = []
        for symbol, referenced in used:
            found.extend(
                f"{symbol} names the private {n}"
                for n in dict.fromkeys(referenced)
                if is_private(n)
            )
    return found


def main():
    arguments = sys.argv[1:]
    report = leaks if arguments[1:] == ["--leaks"] else symbols
    if len(arguments) not in (1, 2) or (len(arguments) == 2 and report is symbols):
        raise SystemExit("usage: python.py <distribution> [--leaks]")
    base, files = installed_files(arguments[0])
    print(
        json.dumps(
            sorted(
                found
                for path in files
                if not private(path, base)
                for found in report(path, base)
            )
        )
    )


main()
