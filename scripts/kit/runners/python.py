"""Runs the unittest tests of a checkout and reports each test as a JSON line on a file descriptor of its own (K1194).

    python3 -c "import runpy, sys; runpy.run_path(sys.argv[1], run_name='__main__')" python.py <module> <arguments>

The -c start leaves sys.path[0] as the current directory, as `python -m unittest` does; run_path adds nothing to sys.path.

The runner replaces the default result class of unittest.TextTestRunner with EventResult and then runs <module> as
`python -m <module>` runs it: unittest itself, or a harness module of the repository that runs its tests through
TextTestRunner. EventResult keeps the verbose output of unittest on standard error, as it is, and writes the start and the
outcome of each test as one JSON line to the file descriptor that KIT_TEST_EVENTS_FD names, which run-tests reads. A test
that writes to standard error, even without a line end, changes no event. At the end of each run of unittest it writes the number
of tests that the run ran, which run-tests compares with the tests that it recorded (K1201). Only the standard library is used, so no
environment needs a package.
"""

import json
import os
import runpy
import sys
import unittest


class EventResult(unittest.TextTestResult):
    """The result of unittest with an event for the start and the outcome of each test."""

    events = None

    def __init__(self, stream, descriptions, verbosity, **options):
        super().__init__(stream, descriptions, verbosity, **options)
        # The tests whose outcome has an event, and the failures of the subtests of each test that has none yet.
        self.reported = set()
        self.subtest_failures = {}

    def emit(self, event, test, text=None):
        record = {"event": event, "id": str(test)}
        if text is not None:
            record["text"] = text
        EventResult.events.write(json.dumps(record) + "\n")
        EventResult.events.flush()

    def outcome(self, event, test, text=None):
        self.reported.add(test.id() if hasattr(test, "id") else str(test))
        self.emit(event, test, text)

    def stopTestRun(self):
        super().stopTestRun()
        # The number of tests that this run of unittest ran, which run-tests compares with the tests of the record (K1201).
        EventResult.events.write(
            json.dumps({"event": "run", "tests": self.testsRun}) + "\n"
        )
        EventResult.events.flush()

    def startTest(self, test):
        self.emit("start", test)
        super().startTest(test)

    def stopTest(self, test):
        super().stopTest(test)
        key = test.id()
        failures = self.subtest_failures.pop(key, None)
        # A test whose subtests failed has no outcome of its own: unittest counts the failures of its subtests.
        if failures is not None and key not in self.reported:
            self.outcome("fail", test, "\n".join(failures))
        self.reported.discard(key)

    def addSuccess(self, test):
        super().addSuccess(test)
        self.outcome("pass", test)

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self.outcome("fail", test, self._exc_info_to_string(err, test))

    def addError(self, test, err):
        super().addError(test, err)
        self.outcome("fail", test, self._exc_info_to_string(err, test))

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.outcome("skip", test, reason)

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self.outcome("todo", test)

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self.outcome("fail", test, "unexpected success")

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err is not None:
            self.subtest_failures.setdefault(test.id(), []).append(
                f"{subtest}\n{self._exc_info_to_string(err, test)}"
            )


def main():
    descriptor = os.environ.get("KIT_TEST_EVENTS_FD")
    if not descriptor or not descriptor.isdigit():
        sys.stderr.write(
            "runners/python.py: KIT_TEST_EVENTS_FD names no file descriptor; run-tests starts this runner\n"
        )
        sys.exit(2)
    # The -c start of run-tests leaves sys.argv as ["-c", <this runner>, <module>, <arguments>].
    if len(sys.argv) < 3:
        sys.stderr.write(
            "usage: python3 -c <start> python.py <module> <arguments of the module>\n"
        )
        sys.exit(2)
    EventResult.events = os.fdopen(int(descriptor), "w", encoding="utf-8")
    unittest.TextTestRunner.resultclass = EventResult
    module = sys.argv[2]
    sys.argv = [module, *sys.argv[3:]]
    runpy.run_module(module, run_name="__main__", alter_sys=True)


main()
