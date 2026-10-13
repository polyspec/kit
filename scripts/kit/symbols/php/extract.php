<?php

// The public symbols of PHP sources, for the language-parity check (scripts/kit/parity-symbols.mts).
//
//   php extract.php <vendor/autoload.php of the install> <directory or file>
//
// Prints a JSON array of the public symbol ids, sorted, read with nikic/php-parser: the syntax of every .php file of the
// entry, or of the entry file, such as the *.stub.php that declares the API of a PHP extension; nothing is loaded or run.
// Names are resolved to their fully qualified form. The ids are Ns\Class for a class, interface, trait or enum,
// Ns\Class::method for a public method, Ns\Class::CONST for a public constant or enum case, Ns\Class::$property for a
// public property (a promoted constructor parameter included), Ns\function for a function and Ns\CONST for a constant.

declare(strict_types=1);

use PhpParser\Node;
use PhpParser\NodeTraverser;
use PhpParser\NodeVisitor\NameResolver;
use PhpParser\NodeVisitorAbstract;
use PhpParser\ParserFactory;

if ($argc !== 3) {
    fwrite(STDERR, "usage: php extract.php <vendor/autoload.php> <directory or file>\n");
    exit(2);
}
require $argv[1];

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

/** Collects the public symbol ids of the nodes that it visits. */
final class PublicSymbols extends NodeVisitorAbstract
{
    /** @var list<string> */
    public array $symbols = [];

    public function enterNode(Node $node): null
    {
        if ($node instanceof Node\Stmt\ClassLike && $node->namespacedName !== null) {
            $class = $node->namespacedName->toString();
            $this->symbols[] = $class;
            foreach ($node->stmts as $member) {
                $this->member($class, $member, $node instanceof Node\Stmt\Interface_);
            }
        } elseif ($node instanceof Node\Stmt\Function_) {
            $this->symbols[] = $node->namespacedName->toString();
        } elseif ($node instanceof Node\Stmt\Const_) {
            foreach ($node->consts as $const) {
                $this->symbols[] = $const->namespacedName->toString();
            }
        }
        return null;
    }

    /** Adds the public member `$member` of the class `$class`; every member of an interface is public. */
    private function member(string $class, Node $member, bool $interface): void
    {
        if ($member instanceof Node\Stmt\ClassMethod && ($interface || $member->isPublic())) {
            $this->symbols[] = "{$class}::{$member->name}";
            if ($member->name->toLowerString() === '__construct') {
                foreach ($member->params as $param) {
                    if ($param->isPublic() && $param->var instanceof Node\Expr\Variable && is_string($param->var->name)) {
                        $this->symbols[] = "{$class}::\${$param->var->name}";
                    }
                }
            }
        } elseif ($member instanceof Node\Stmt\ClassConst && ($interface || $member->isPublic())) {
            foreach ($member->consts as $const) {
                $this->symbols[] = "{$class}::{$const->name}";
            }
        } elseif ($member instanceof Node\Stmt\EnumCase) {
            $this->symbols[] = "{$class}::{$member->name}";
        } elseif ($member instanceof Node\Stmt\Property && $member->isPublic()) {
            foreach ($member->props as $property) {
                $this->symbols[] = "{$class}::\${$property->name}";
            }
        }
    }
}

$parser = (new ParserFactory())->createForNewestSupportedVersion();
$visitor = new PublicSymbols();
$traverser = new NodeTraverser(new NameResolver(), $visitor);
foreach ($files as $file) {
    $traverser->traverse($parser->parse((string) file_get_contents($file)) ?? []);
}
$symbols = array_values(array_unique($visitor->symbols));
sort($symbols);
echo json_encode($symbols, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES), "\n";
