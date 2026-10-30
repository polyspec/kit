<?php

// The visitor of extract.php: the public symbol ids of the nodes of a PHP syntax tree, read with nikic/php-parser.

declare(strict_types=1);

namespace Polyspec\Kit\Symbols;

use PhpParser\Node;
use PhpParser\NodeVisitorAbstract;

/**
 * Collects the public symbol ids of the nodes that it visits. A class, function, constant, method or property whose
 * docblock carries @internal is no public API (K307), and a class that carries it hides its members.
 */
final class PublicSymbols extends NodeVisitorAbstract
{
    /** @var list<string> */
    public array $symbols = [];

    /** @var array<string, true> the classes whose docblock carries @internal, by fully qualified name */
    private array $internalClasses = [];

    /** @var list<array{string, callable(): list<string>}> a public symbol and what reads the classes that its signature, parent or interface names */
    private array $references = [];

    /** @var array<string, Node\Stmt\Trait_> trait declarations, including internal traits used by public classes */
    private array $traits = [];

    /** @var list<array{string, Node\Stmt\ClassLike}> public class-like declarations whose trait members are composed after parsing */
    private array $classLikes = [];

    /** The namespace of the statements being visited, which a polyfill guard is read in (K897). */
    private ?string $namespace = null;

    /** Each file starts outside a namespace: one visitor reads every file of the entry (K897). */
    public function beforeTraverse(array $nodes): null
    {
        $this->namespace = null;
        return null;
    }

    public function enterNode(Node $node): null
    {
        if ($node instanceof Node\Stmt\Namespace_) {
            $this->namespace = $node->name?->toString();
        }
        if ($node instanceof Node\Stmt\Trait_ && $node->namespacedName !== null) {
            $this->traits[$node->namespacedName->toString()] = $node;
        }
        if ($this->internal($node)) {
            if ($node instanceof Node\Stmt\ClassLike && $node->namespacedName !== null) {
                $this->internalClasses[$node->namespacedName->toString()] = true;
            }
            return null;
        }
        if ($node instanceof Node\Stmt\ClassLike && $node->namespacedName !== null) {
            $class = $node->namespacedName->toString();
            $this->symbols[] = $class;
            $this->classLikes[] = [$class, $node];
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
        } elseif ($node instanceof Node\Stmt\If_ && $this->namespace !== null) {
            // The define() of a polyfill guard (K873) declares a namespaced constant unless it is @internal (K897).
            $constant = AutoloadFiles::guardedConstant($node, $this->namespace);
            if ($constant !== null && !$this->internal($node->stmts[0])) {
                $this->symbols[] = $constant;
            }
        }
        return null;
    }

    /** Adds members supplied by traits after every parsed file has registered its trait declarations. */
    public function afterTraverse(array $nodes): null
    {
        foreach ($this->classLikes as [$class, $classLike]) {
            $declared = [];
            foreach ($classLike->stmts as $member) {
                if ($member instanceof Node\Stmt\ClassMethod) {
                    $declared[strtolower($member->name->toString())] = true;
                }
            }
            foreach ($classLike->stmts as $member) {
                if (!$member instanceof Node\Stmt\TraitUse) {
                    continue;
                }
                foreach ($this->composeTraitUse($member) as $entry) {
                    $effectiveName = $entry['name'] ?? (
                        $entry['node'] instanceof Node\Stmt\ClassMethod
                            ? $entry['node']->name->toString()
                            : null
                    );
                    if ($effectiveName !== null && isset($declared[strtolower($effectiveName)])) {
                        continue;
                    }
                    if ($entry['visibility'] === Node\Stmt\Class_::MODIFIER_PRIVATE) {
                        continue;
                    }
                    $this->member(
                        $class,
                        $entry['node'],
                        $classLike instanceof Node\Stmt\Interface_,
                        $entry['visibility'] === Node\Stmt\Class_::MODIFIER_PUBLIC,
                        $entry['name']
                    );
                }
            }
        }
        return null;
    }

    /**
     * The effective members supplied by a trait, including traits it uses; a declaration overrides a nested trait
     * member.
     *
     * @param array<string, true> $seen
     * @return list<array{trait: string, node: Node, visibility: int|null, name: string|null}>
     */
    private function traitMembers(string $name, array $seen = []): array
    {
        if (isset($seen[$name]) || !isset($this->traits[$name])) {
            return [];
        }
        $seen[$name] = true;
        $trait = $this->traits[$name];
        $members = [];
        foreach ($trait->stmts as $member) {
            if (!$member instanceof Node\Stmt\TraitUse) {
                continue;
            }
            foreach ($this->composeTraitUse($member, $seen) as $nestedMember) {
                $key = $this->entryKey($nestedMember);
                if ($key !== null) {
                    $members[$key] = $nestedMember;
                }
            }
        }
        foreach ($trait->stmts as $member) {
            if ($member instanceof Node\Stmt\TraitUse) {
                continue;
            }
            $key = $this->memberKey($member);
            if ($key !== null) {
                $members[$key] = ['trait' => $name, 'node' => $member, 'visibility' => null, 'name' => null];
            }
        }
        return array_values($members);
    }

    /** Applies PHP trait precedence and alias adaptations and returns the effective members of one trait-use. */
    private function composeTraitUse(Node\Stmt\TraitUse $use, array $seen = []): array
    {
        $methods = [];
        $members = [];
        foreach ($use->traits as $trait) {
            $traitName = $trait->toString();
            foreach ($this->traitMembers($traitName, $seen) as $entry) {
                $entry['trait'] = $traitName;
                if ($entry['node'] instanceof Node\Stmt\ClassMethod) {
                    $methods[] = $entry;
                } else {
                    $members[] = $entry;
                }
            }
        }
        foreach ($use->adaptations as $adaptation) {
            if (!$adaptation instanceof Node\Stmt\TraitUseAdaptation\Precedence) {
                continue;
            }
            $winner = $adaptation->trait?->toString();
            foreach ($adaptation->insteadof as $loser) {
                $loserName = $loser->toString();
                $methods = array_values(array_filter(
                    $methods,
                    static fn(array $entry): bool => !(
                        strcasecmp($entry['trait'], $loserName) === 0
                        && strcasecmp(
                            $entry['name'] ?? $entry['node']->name->toString(),
                            $adaptation->method->toString()
                        ) === 0
                        && ($winner === null || strcasecmp($entry['trait'], $winner) !== 0)
                    )
                ));
            }
        }
        $aliases = [];
        foreach ($use->adaptations as $adaptation) {
            if (!$adaptation instanceof Node\Stmt\TraitUseAdaptation\Alias) {
                continue;
            }
            $methodName = $adaptation->method->toString();
            $traitName = $adaptation->trait?->toString();
            foreach ($methods as $index => $entry) {
                $candidateName = $entry['name'] ?? $entry['node']->name->toString();
                if (
                    strcasecmp($candidateName, $methodName) !== 0
                    || ($traitName !== null && strcasecmp($entry['trait'], $traitName) !== 0)
                ) {
                    continue;
                }
                if ($adaptation->newName !== null) {
                    $aliases[] = [
                        'trait' => $entry['trait'],
                        'node' => $entry['node'],
                        'visibility' => $adaptation->newModifier,
                        'name' => $adaptation->newName->toString(),
                    ];
                } elseif ($adaptation->newModifier !== null) {
                    $methods[$index]['visibility'] = $adaptation->newModifier;
                }
            }
        }
        return [...$methods, ...$aliases, ...$members];
    }

    /** The effective member key of a trait-use entry. */
    private function entryKey(array $entry): ?string
    {
        if ($entry['node'] instanceof Node\Stmt\ClassMethod && $entry['name'] !== null) {
            return 'method:' . strtolower($entry['name']);
        }
        return $this->memberKey($entry['node']);
    }

    /** A trait member's effective-name key, for direct declarations to override nested traits. */
    private function memberKey(Node $member): ?string
    {
        if ($member instanceof Node\Stmt\ClassMethod) {
            return 'method:' . strtolower($member->name->toString());
        }
        if ($member instanceof Node\Stmt\Property) {
            $names = array_map(
                static fn(Node\Stmt\PropertyProperty $property): string => $property->name->toString(),
                $member->props
            );
            return 'property:' . implode(',', $names);
        }
        if ($member instanceof Node\Stmt\ClassConst) {
            $names = array_map(
                static fn(Node\Const_ $constant): string => $constant->name->toString(),
                $member->consts
            );
            return 'constant:' . implode(',', $names);
        }
        if ($member instanceof Node\Stmt\EnumCase) {
            return 'case:' . $member->name->toString();
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
    private function member(
        string $class,
        Node $member,
        bool $interface,
        bool $forcePublic = false,
        ?string $methodName = null
    ): void {
        if ($this->internal($member)) {
            return;
        }
        if ($member instanceof Node\Stmt\ClassMethod && ($interface || $forcePublic || $member->isPublic())) {
            $effectiveName = $methodName ?? $member->name->toString();
            $this->symbols[] = "{$class}::{$effectiveName}";
            $this->signature("{$class}::{$effectiveName}", $member);
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
     * The public symbols whose signature, parent or interface names a class that carries @internal (K307-1): the
     * symbol and the internal class, as "A::m names the internal B". Known after every file was visited.
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
        $list = match (true) {
            $node instanceof Node\Stmt\Interface_ => $node->extends,
            $node instanceof Node\Stmt\Class_, $node instanceof Node\Stmt\Enum_ => $node->implements,
            default => [],
        };
        foreach ($list as $name) {
            $names[] = $name->toString();
        }
        return $names;
    }

    /**
     * Records the classes that the parameter types and the return type of `$function` name. They are read when the
     * leaks are asked for, since the NameResolver resolves a type after this visitor has seen the declaration that
     * holds it.
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
