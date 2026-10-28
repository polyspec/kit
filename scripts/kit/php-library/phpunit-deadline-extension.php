<?php

declare(strict_types=1);

namespace Polyspec\Kit\PHPUnit;

use PHPUnit\Runner\Extension\Extension;
use PHPUnit\Runner\Extension\Facade;
use PHPUnit\Runner\Extension\ParameterCollection;
use PHPUnit\TextUI\Configuration\Configuration;

final class DeadlineExtension implements Extension
{
    public function bootstrap(Configuration $configuration, Facade $facade, ParameterCollection $parameters): void
    {
        if (!$configuration->enforceTimeLimit()) {
            return;
        }

        $facade->registerSubscriber(new DeadlineSubscriber($configuration));
    }
}
