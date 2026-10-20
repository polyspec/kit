// The public symbols of a Go module, for the language-parity check (scripts/kit/parity-symbols.mts).
//
//	kit-symbols-go <module directory>
//
// Prints a JSON array of the public symbol ids, sorted, read with golang.org/x/tools/go/packages from the type information
// of the packages ./... of the directory, without their tests. A package whose import path has an internal element is not
// public. The public symbols of a package are its exported package-level names, as <import path>.<name>, and the exported
// methods and fields of its exported named types, as <import path>.<type>.<name>.
package main

import (
	"encoding/json"
	"fmt"
	"go/types"
	"os"
	"sort"
	"strings"

	"golang.org/x/tools/go/packages"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: kit-symbols-go <module directory>")
		os.Exit(2)
	}
	config := &packages.Config{Mode: packages.NeedName | packages.NeedTypes, Dir: os.Args[1]}
	loaded, err := packages.Load(config, "./...")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if packages.PrintErrors(loaded) > 0 {
		os.Exit(1)
	}
	symbols := []string{}
	for _, pkg := range loaded {
		if pkg.Name == "main" || internal(pkg.PkgPath) {
			continue
		}
		scope := pkg.Types.Scope()
		for _, name := range scope.Names() {
			object := scope.Lookup(name)
			if !object.Exported() {
				continue
			}
			symbols = append(symbols, pkg.PkgPath+"."+name)
			if _, ok := object.(*types.TypeName); ok {
				if named, ok := object.Type().(*types.Named); ok {
					symbols = append(symbols, members(pkg.PkgPath+"."+name, named)...)
				}
			}
		}
	}
	sort.Strings(symbols)
	out, err := json.Marshal(symbols)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(string(out))
}

// internal reports whether the import path has an internal element, which no other module may import.
func internal(path string) bool {
	for _, element := range strings.Split(path, "/") {
		if element == "internal" {
			return true
		}
	}
	return false
}

// members are the exported methods of the named type (of its pointer, unless it is an interface), and the exported fields
// of its struct.
func members(prefix string, named *types.Named) []string {
	found := []string{}
	var methods *types.MethodSet
	if types.IsInterface(named) {
		methods = types.NewMethodSet(named)
	} else {
		methods = types.NewMethodSet(types.NewPointer(named))
	}
	for index := 0; index < methods.Len(); index++ {
		if method := methods.At(index).Obj(); method.Exported() {
			found = append(found, prefix+"."+method.Name())
		}
	}
	if structure, ok := named.Underlying().(*types.Struct); ok {
		for index := 0; index < structure.NumFields(); index++ {
			if field := structure.Field(index); field.Exported() {
				found = append(found, prefix+"."+field.Name())
			}
		}
	}
	return found
}
