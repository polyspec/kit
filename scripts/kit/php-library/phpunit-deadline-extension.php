<?php declare(strict_types=1);

use PHPUnit\Event\Code\TestMethod;
use PHPUnit\Event\Test\PreparationStarted;
use PHPUnit\Event\Test\PreparationStartedSubscriber;
use PHPUnit\Metadata\Group;
use PHPUnit\Runner\Extension\Extension;
use PHPUnit\Runner\Extension\Facade;
use PHPUnit\Runner\Extension\ParameterCollection;
use PHPUnit\TextUI\Configuration\Configuration;

final class KitPHPUnitDeadlineExtension implements Extension
{
    public function bootstrap(Configuration $configuration, Facade $facade, ParameterCollection $parameters): void
    {
        if (!$configuration->enforceTimeLimit()) {
            return;
        }

        $facade->registerSubscriber(new KitPHPUnitDeadlineSubscriber($configuration));
    }
}

final class KitPHPUnitDeadlineSubscriber implements PreparationStartedSubscriber
{
    private static mixed $pipe = null;

    public function __construct(private readonly Configuration $configuration)
    {
    }

    public function notify(PreparationStarted $event): void
    {
        $test = $event->test();
        if (!$test instanceof TestMethod) {
            return;
        }

        $groups = [];
        foreach ($test->metadata()->asArray() as $metadata) {
            if ($metadata instanceof Group) {
                $groups[$metadata->groupName()] = true;
            }
        }

        $seconds = isset($groups['large']) ? $this->configuration->timeoutForLargeTests()
            : (isset($groups['medium']) ? $this->configuration->timeoutForMediumTests()
                : (isset($groups['small']) ? $this->configuration->timeoutForSmallTests()
                    : $this->configuration->defaultTimeLimit()));
        if ($seconds < 1) {
            return;
        }

        $fileDescriptor = getenv('KIT_TEST_EVENTS');
        if (!is_string($fileDescriptor) || !ctype_digit($fileDescriptor)) {
            throw new RuntimeException('KIT_TEST_EVENTS must name the deadline event pipe; run PHPUnit through Kit');
        }

        $class = $test->className();
        $separator = strrpos($class, '\\');
        $id = ($separator === false ? $class : substr($class, $separator + 1)) . '::' . $test->name();
        $event = json_encode(['kind' => 'timeout', 'id' => $id, 'timeoutMs' => $seconds * 1000], JSON_THROW_ON_ERROR) . "\n";
        if (self::$pipe === null) {
            self::$pipe = fopen('php://fd/' . $fileDescriptor, 'wb');
            if (self::$pipe === false) {
                throw new RuntimeException('could not open the Kit test event pipe');
            }
        }

        if (fwrite(self::$pipe, $event) !== strlen($event)) {
            throw new RuntimeException('could not write the PHPUnit deadline event');
        }
        if (!fflush(self::$pipe)) {
            throw new RuntimeException('could not flush the PHPUnit deadline event');
        }
    }
}
