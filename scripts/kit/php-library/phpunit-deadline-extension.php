<?php

declare(strict_types=1);

namespace Polyspec\Kit\PHPUnit;

use PHPUnit\Runner\Extension\Extension;
use PHPUnit\Runner\Extension\Facade;
use PHPUnit\Runner\Extension\ParameterCollection;
use PHPUnit\TextUI\Configuration\Configuration;

final class DeadlineExtension implements Extension
{
    // The subscriber sends the deadline of each case to the runner whatever enforceTimeLimit says, so a repository that turns
    // the native time limit off keeps the runner's deadline as the only bound (K1170).
    public function bootstrap(Configuration $configuration, Facade $facade, ParameterCollection $parameters): void
    {
        $facade->registerSubscriber(new DeadlineSubscriber($configuration));
    }
}
