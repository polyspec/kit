<?php

// The public symbols of PHP sources, for the language-parity check (scripts/kit/parity-symbols.mts).
//
//   php extract.php <vendor/autoload.php of the install> <directory or file> [--leaks]
//
// Prints a JSON array of the public symbol ids, sorted, read with nikic/php-parser (PublicSymbols.php): the syntax of
// every .php file of the entry, or of the entry file, such as the *.stub.php that declares the API of a PHP extension;
// nothing is loaded or run. Names are resolved to their fully qualified form. The ids are Ns\Class for a class,
// interface, trait or enum, Ns\Class::method for a public method, Ns\Class::CONST for a public constant or enum case,
// Ns\Class::$property for a public property (a promoted constructor parameter included), Ns\function for a function and
// Ns\CONST for a constant. With --leaks it prints instead the public symbols whose signature, parent or interface names
// a class that carries @internal, as "Ns\Class::method names the internal Ns\Hidden" (K307-1).

declare(strict_types=1);

use PhpParser\NodeTraverser;
use PhpParser\NodeVisitor\NameResolver;
use PhpParser\ParserFactory;
use Polyspec\Kit\Symbols\PublicSymbols;

if ($argc !== 3 && !($argc === 4 && $argv[3] === '--leaks')) {
    fwrite(STDERR, "usage: php extract.php <vendor/autoload.php> <directory or file> [--leaks]\n");
    exit(2);
}
require $argv[1];
// The installed vendor/ holds php-parser only; the visitor is a source file of the extractor beside this one.
require __DIR__ . '/PublicSymbols.php';

$entry = $argv[2];
if (is_dir($entry)) {
    $files = [];
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($entry, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if ($file->isFile() && str_ends_with($file->getFilename(), '.php')) {
            $files[] = $file->getPathname();
        }
    }
    sort($files);
} elseif (is_file($entry)) {
    $files = [$entry];
} else {
    fwrite(STDERR, "{$entry} does not exist\n");
    exit(1);
}

$parser = (new ParserFactory())->createForNewestSupportedVersion();
$visitor = new PublicSymbols();
$traverser = new NodeTraverser(new NameResolver(), $visitor);
foreach ($files as $file) {
    $traverser->traverse($parser->parse((string) file_get_contents($file)) ?? []);
}
if ($argc === 4) {
    // K307-1: the public signatures, parents and interfaces that name a class carrying @internal.
    echo json_encode($visitor->leaks(), JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES), "\n";
    exit(0);
}
$symbols = array_values(array_unique($visitor->symbols));
sort($symbols);
echo json_encode($symbols, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES), "\n";
