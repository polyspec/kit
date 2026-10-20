<?php

declare(strict_types=1);

// The declarations that Reflection reads at run time, as JSON on standard output, for the declaration test of a
// PHP extension (php-extension.mts, S10): the classes, functions and constants that a loaded extension registers, or
// the same names as the PHP library declares them through its Composer autoloader. A constant lists its value, or null
// when the library defines none; the names of the constants are compared, not their values (K338). A class lists its
// kind, modifiers, parent, interfaces, constants, public and protected properties and methods; a method or function
// its modifiers, return type and parameters. A union type lists its members sorted, since the order of a declaration
// is no part of the type.
//
//   php reflection.php extension <extension name>
//   php reflection.php library <autoload.php> <file of the JSON names>
//     the names: {"classes": [...], "functions": [...], "constants": [...]}
//
// The file declares no symbol, so it is a script with side effects only (PSR-1).

$type = static function (?ReflectionType $type): ?string {
    if ($type === null) {
        return null;
    }
    $text = (string) $type;
    if (!$type instanceof ReflectionUnionType || str_contains($text, '(')) {
        return $text;
    }
    $members = explode('|', $text);
    sort($members);
    return implode('|', $members);
};

$callable = static function (ReflectionFunctionAbstract $function) use ($type): array {
    $parameters = [];
    foreach ($function->getParameters() as $parameter) {
        $default = null;
        if ($parameter->isDefaultValueAvailable()) {
            $default = $parameter->isDefaultValueConstant()
                ? $parameter->getDefaultValueConstantName()
                : var_export($parameter->getDefaultValue(), true);
        }
        $parameters[] = [
            'name' => $parameter->getName(),
            'type' => $type($parameter->getType()),
            'optional' => $parameter->isOptional(),
            'variadic' => $parameter->isVariadic(),
            'byReference' => $parameter->isPassedByReference(),
            'default' => $default,
        ];
    }
    return [
        'returnType' => $type(
            $function->hasTentativeReturnType() ? $function->getTentativeReturnType() : $function->getReturnType()
        ),
        'returnsReference' => $function->returnsReference(),
        'parameters' => $parameters,
    ];
};

$class = static function (ReflectionClass $class) use ($type, $callable): array {
    $kind = match (true) {
        $class->isEnum() => 'enum',
        $class->isInterface() => 'interface',
        $class->isTrait() => 'trait',
        default => 'class',
    };
    $constants = [];
    foreach ($class->getReflectionConstants() as $constant) {
        if (!$constant->isPrivate()) {
            $constants[$constant->getName()] = [
                'final' => $constant->isFinal(),
                'value' => var_export($constant->getValue(), true),
            ];
        }
    }
    $properties = [];
    foreach ($class->getProperties() as $property) {
        if (!$property->isPrivate()) {
            $properties[$property->getName()] = [
                'type' => $type($property->getType()),
                'static' => $property->isStatic(),
                'readonly' => $property->isReadOnly(),
                'protected' => $property->isProtected(),
            ];
        }
    }
    $methods = [];
    foreach ($class->getMethods() as $method) {
        if (!$method->isPrivate()) {
            $methods[$method->getName()] = [
                'static' => $method->isStatic(),
                'final' => $method->isFinal(),
                'abstract' => $method->isAbstract(),
                'protected' => $method->isProtected(),
            ] + $callable($method);
        }
    }
    $interfaces = $class->getInterfaceNames();
    sort($interfaces);
    ksort($constants);
    ksort($properties);
    ksort($methods);
    $parent = $class->getParentClass();
    return [
        'kind' => $kind,
        'final' => $class->isFinal(),
        'abstract' => $kind === 'class' && $class->isAbstract(),
        'readonly' => $class->isReadOnly(),
        'parent' => $parent === false ? null : $parent->getName(),
        'interfaces' => $interfaces,
        'constants' => (object) $constants,
        'properties' => (object) $properties,
        'methods' => (object) $methods,
    ];
};

// The constants of the extension and of the library are read by name (K338): a constant that the library
// defines is declared.
$declarations = ['classes' => [], 'functions' => [], 'constants' => []];
$mode = $argv[1] ?? '';
if ($mode === 'extension' && isset($argv[2])) {
    $extension = new ReflectionExtension($argv[2]);
    foreach ($extension->getClasses() as $reflection) {
        $declarations['classes'][$reflection->getName()] = $class($reflection);
    }
    foreach ($extension->getFunctions() as $reflection) {
        $declarations['functions'][$reflection->getName()] = $callable($reflection);
    }
    foreach ($extension->getConstants() as $name => $value) {
        $declarations['constants'][$name] = var_export($value, true);
    }
} elseif ($mode === 'library' && isset($argv[2], $argv[3])) {
    require $argv[2];
    $names = json_decode((string) file_get_contents($argv[3]), true, flags: JSON_THROW_ON_ERROR);
    foreach ($names['classes'] as $name) {
        $exists = class_exists($name) || interface_exists($name) || trait_exists($name) || enum_exists($name);
        $declarations['classes'][$name] = $exists ? $class(new ReflectionClass($name)) : null;
    }
    foreach ($names['functions'] as $name) {
        $declarations['functions'][$name] = function_exists($name) ? $callable(new ReflectionFunction($name)) : null;
    }
    foreach ($names['constants'] as $name) {
        $declarations['constants'][$name] = defined($name) ? var_export(constant($name), true) : null;
    }
} else {
    fwrite(STDERR, "usage: php reflection.php extension <extension name> | library <autoload.php> <names.json>\n");
    exit(2);
}
ksort($declarations['classes']);
ksort($declarations['functions']);
ksort($declarations['constants']);
// A map is an object in JSON also when it is empty, so an empty map never compares as a list.
$declarations = [
    'classes' => (object) $declarations['classes'],
    'functions' => (object) $declarations['functions'],
    'constants' => (object) $declarations['constants'],
];
echo json_encode($declarations, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
