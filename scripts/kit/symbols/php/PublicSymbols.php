<?php

// The visitor of extract.php: the public symbol ids of the nodes of a PHP syntax tree, read with nikic/php-parser.

declare(strict_types=1);

namespace Polyspec\Kit\Symbols;

use PhpParser\Node;
use PhpParser\NodeVisitorAbstract;

/**
 * Collects the public symbol ids of the nodes that it visits. A class, function, constant, method or property whose docblock
 * carries @internal is no public API (K307), and a class that carries it hides its members.
 */
final class PublicSymbols extends NodeVisitorAbstract
{
    /** @var list<string> */
    public array $symbols = [];

    /** @var array<string, true> the classes whose docblock carries @internal, by fully qualified name */
    private array $internalClasses = [];

    /** @var list<array{string, callable(): list<string>}> a public symbol and what reads the classes that its signature, parent or interface names */
    private array $references = [];

    public function enterNode(Node $node): null
    {
        if ($this->internal($node)) {
            if ($node instanceof Node\Stmt\ClassLike && $node->namespacedName !== null) {
                $this->internalClasses[$node->namespacedName->toString()] = true;
            }
            return null;
        }
        if ($node instanceof Node\Stmt\ClassLike && $node->namespacedName !== null) {
            $class = $node->namespacedName->toString();
            $this->symbols[] = $class;
            $this->references[] = [$class, fn (): array => $this->parents($node)];
            foreach ($node->stmts as $member) {
                $this->member($class, $member, $node instanceof Node\Stmt\Interface_);
            }
        } elseif ($node instanceof Node\Stmt\Function_) {
            $function = $node->namespacedName->toString();
            $this->symbols[] = $function;
            $this->signature($function, $node);
        } elseif ($node instanceof Node\Stmt\Const_) {
            foreach ($node->consts as $const) {
                $this->symbols[] = $const->namespacedName->toString();
            }
        }
        return null;
    }

    /** Whether the docblock of `$node` carries an @internal tag, as phpstan and psalm read it: the tag opens a docblock line. */
    private function internal(Node $node): bool
    {
        $doc = $node->getDocComment();
        return $doc !== null && preg_match('/^[ \t]*(?:\/\*\*|\*)?[ \t]*@internal(?:\s|$)/m', $doc->getText()) === 1;
    }

    /** Adds the public member `$member` of the class `$class`; every member of an interface is public. */
    private function member(string $class, Node $member, bool $interface): void
    {
        if ($this->internal($member)) {
            return;
        }
        if ($member instanceof Node\Stmt\ClassMethod && ($interface || $member->isPublic())) {
            $this->symbols[] = "{$class}::{$member->name}";
            $this->signature("{$class}::{$member->name}", $member);
            if ($member->name->toLowerString() === '__construct') {
                foreach ($member->params as $param) {
                    $name = $param->var instanceof Node\Expr\Variable ? $param->var->name : null;
                    if ($param->isPublic() && is_string($name)) {
                        $this->symbols[] = "{$class}::\${$name}";
                        $this->typed("{$class}::\${$name}", $param);
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
                $this->typed("{$class}::\${$property->name}", $member);
            }
        }
    }

    /**
     * The public symbols whose signature, parent or interface names a class that carries @internal (K307-1): the symbol and the
     * internal class, as "A::m names the internal B". Known after every file was visited.
     *
     * @return list<string>
     */
    public function leaks(): array
    {
        $leaks = [];
        foreach ($this->references as [$symbol, $names]) {
            foreach ($names() as $name) {
                if (isset($this->internalClasses[$name])) {
                    $leaks[] = "{$symbol} names the internal {$name}";
                }
            }
        }
        $leaks = array_values(array_unique($leaks));
        sort($leaks);
        return $leaks;
    }

    /** The names of the parent and the interfaces of a class-like. @return list<string> */
    private function parents(Node\Stmt\ClassLike $node): array
    {
        $names = [];
        if ($node instanceof Node\Stmt\Class_ && $node->extends !== null) {
            $names[] = $node->extends->toString();
        }
        $list = $node instanceof Node\Stmt\Interface_ ? $node->extends : ($node instanceof Node\Stmt\Class_ || $node instanceof Node\Stmt\Enum_ ? $node->implements : []);
        foreach ($list as $name) {
            $names[] = $name->toString();
        }
        return $names;
    }

    /**
     * Records the classes that the parameter types and the return type of `$function` name. They are read when the leaks are
     * asked for, since the NameResolver resolves a type after this visitor has seen the declaration that holds it.
     */
    private function signature(string $symbol, Node\FunctionLike $function): void
    {
        $this->references[] = [$symbol, function () use ($function): array {
            $names = [];
            foreach ($function->getParams() as $param) {
                $names = array_merge($names, $this->typeNames($param->type));
            }
            return array_merge($names, $this->typeNames($function->getReturnType()));
        }];
    }

    /** Records the classes that the type of `$holder` (a parameter or a property) names, read later as signature reads them. */
    private function typed(string $symbol, Node\Param|Node\Stmt\Property $holder): void
    {
        $this->references[] = [$symbol, fn (): array => $this->typeNames($holder->type)];
    }

    /** @return list<string> */
    private function typeNames(?Node $type): array
    {
        if ($type instanceof Node\Name) {
            return [$type->toString()];
        }
        if ($type instanceof Node\NullableType) {
            return $this->typeNames($type->type);
        }
        if ($type instanceof Node\UnionType || $type instanceof Node\IntersectionType) {
            return array_merge(...array_map(fn (Node $item): array => $this->typeNames($item), $type->types));
        }
        return [];
    }
}
