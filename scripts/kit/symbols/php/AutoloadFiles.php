<?php

// The check of the autoload files of lint-php (K377), read with nikic/php-parser beside the visitor of extract.php.

declare(strict_types=1);

namespace Polyspec\Kit\Symbols;

use PhpParser\Error;
use PhpParser\Node;
use PhpParser\NodeFinder;
use PhpParser\ParserFactory;

/**
 * The statements that an autoload file of a Composer package may hold (S2): declarations of namespaced functions and
 * constants, with declare(strict_types=1), the namespace declaration, use imports and define() of a namespaced constant
 * name. A require or include, another statement, a class, interface, trait or enum, and a function or constant outside
 * a namespace are findings, and so is a file that does not parse.
 */
final class AutoloadFiles
{
    private const SHAPE = 'an autoload file holds only declarations of namespaced functions and constants (K377)';

    /** Prints a finding for each statement of `$files` that is not allowed, and returns the number of findings. */
    public static function check(array $files): int
    {
        $parser = (new ParserFactory())->createForNewestSupportedVersion();
        $findings = 0;
        foreach ($files as $file) {
            if (!is_file($file)) {
                self::finding($file, 1, 'the file does not exist; ' . self::SHAPE, $findings);
                continue;
            }
            try {
                $tree = $parser->parse((string) file_get_contents($file)) ?? [];
            } catch (Error $error) {
                $message = 'the file does not parse: ' . $error->getMessage();
                self::finding($file, $error->getStartLine(), $message, $findings);
                continue;
            }
            self::statements($tree, false, $file, $findings);
        }
        return $findings;
    }

    /** Prints a finding for `$file` at `$line` and counts it in `$findings`. */
    private static function finding(string $file, int $line, string $message, int &$findings): void
    {
        echo "{$file}:{$line}: {$message}\n";
        $findings++;
    }

    /** Checks the statements of one scope; `$namespaced` tells whether it is a namespace, not the global one. */
    private static function statements(array $statements, bool $namespaced, string $file, int &$findings): void
    {
        foreach ($statements as $statement) {
            // A namespace declaration without braces holds the statements after it as siblings: it is namespaced.
            if ($statement instanceof Node\Stmt\Namespace_) {
                if ($statement->stmts === null) {
                    $namespaced = $statement->name !== null;
                } else {
                    self::statements($statement->stmts, $statement->name !== null, $file, $findings);
                }
                continue;
            }
            $problem = self::problem($statement, $namespaced);
            if ($problem !== null) {
                self::finding($file, $statement->getStartLine(), $problem . '; ' . self::SHAPE, $findings);
            }
        }
    }

    /** What `$statement` holds that an autoload file may not, in a namespaced scope or not; null if it is allowed. */
    private static function problem(Node\Stmt $statement, bool $namespaced): ?string
    {
        if ((new NodeFinder())->findFirstInstanceOf($statement, Node\Expr\Include_::class) !== null) {
            return 'a require or include';
        }
        if ($statement instanceof Node\Stmt\Declare_) {
            foreach ($statement->declares as $declare) {
                if ($declare->key->toLowerString() !== 'strict_types') {
                    return 'a declare other than strict_types';
                }
            }
            return null;
        }
        if ($statement instanceof Node\Stmt\Use_ || $statement instanceof Node\Stmt\GroupUse) {
            return null;
        }
        if ($statement instanceof Node\Stmt\Function_ || $statement instanceof Node\Stmt\Const_) {
            return $namespaced ? null : 'a function or constant outside a namespace';
        }
        if ($statement instanceof Node\Stmt\Expression && $namespaced && self::isNamespacedDefine($statement->expr)) {
            return null;
        }
        return $statement instanceof Node\Stmt\ClassLike ? 'a class, interface, trait or enum' : 'another statement';
    }

    /** Whether `$expr` is define() of a namespaced constant name: a string literal with a namespace separator. */
    private static function isNamespacedDefine(Node\Expr $expr): bool
    {
        if (!$expr instanceof Node\Expr\FuncCall || !$expr->name instanceof Node\Name) {
            return false;
        }
        $name = $expr->args[0]->value ?? null;
        $defined = $name instanceof Node\Scalar\String_ ? ltrim($name->value, '\\') : '';
        return $expr->name->toLowerString() === 'define' && str_contains($defined, '\\');
    }
}
