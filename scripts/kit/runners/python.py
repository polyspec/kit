"""Runs the unittest tests of a checkout as `python -m unittest -v` does, with a timeout for each test and the elapsed time of
each test (K371).

    python3 -c "import runpy, sys; runpy.run_path(sys.argv[1], run_name='__main__')" python.py --timeout <seconds> <arguments>

The -c start leaves sys.path[0] as the current directory, as `python -m unittest` does; run_path adds nothing to sys.path.

The arguments after --timeout are those of unittest (a discover, test names, -v), which unittest.main reads as they are. A test
has its timeout: the runner arms signal.setitimer(ITIMER_REAL) when the test starts and disarms it when the test stops; when the
timer expires, the handler raises an AssertionError in the test, so the test fails with the message `the test outlived its
timeout of <seconds>s`. The line of each test ends with its elapsed time, as in `test_x (pkg.mod.C.test_x) ... ok (0.012s)`.
Only the standard library is used, so no environment needs a package.
"""

import functools
import signal
import sys
import time
import unittest


class Elapsed:
    """The standard error of the results: the elapsed time that is set is written before the newline of the status of a test."""

    def __init__(self, stream):
        self.stream = stream
        self.suffix = ""

    def write(self, text):
        if self.suffix and "\n" in text:
            head, newline, tail = text.partition("\n")
            text = f"{head}{self.suffix}{newline}{tail}"
            self.suffix = ""
        return self.stream.write(text)

    def writeln(self, text=""):
        self.write(text)
        self.write("\n")

    def __getattr__(self, name):
        return getattr(self.stream, name)


def with_elapsed(add):
    """The add method of a result, which first sets the elapsed time of the test for its status line."""

    @functools.wraps(add)
    def elapsed(self, test, *args):
        self.stream.suffix = f" ({time.perf_counter() - self.began:.3f}s)"
        add(self, test, *args)

    return elapsed


class TimedResult(unittest.TextTestResult):
    """The verbose result of unittest, with the timeout of each test and its elapsed time on its line."""

    timeout = None
    began = 0.0

    def __init__(self, stream, descriptions, verbosity, **options):
        super().__init__(Elapsed(stream), descriptions, verbosity, **options)

    def startTest(self, test):
        super().startTest(test)
        self.began = time.perf_counter()
        if self.timeout is not None:
            signal.setitimer(signal.ITIMER_REAL, self.timeout)

    def stopTest(self, test):
        signal.setitimer(signal.ITIMER_REAL, 0)
        super().stopTest(test)

    addSuccess = with_elapsed(unittest.TextTestResult.addSuccess)
    addFailure = with_elapsed(unittest.TextTestResult.addFailure)
    addError = with_elapsed(unittest.TextTestResult.addError)
    addSkip = with_elapsed(unittest.TextTestResult.addSkip)
    addExpectedFailure = with_elapsed(unittest.TextTestResult.addExpectedFailure)
    addUnexpectedSuccess = with_elapsed(unittest.TextTestResult.addUnexpectedSuccess)


class TimedRunner(unittest.TextTestRunner):
    """The text runner of unittest, which gives each test the result TimedResult."""

    def __init__(self, **options):
        super().__init__(resultclass=TimedResult, **options)


def main(argv):
    if len(argv) < 2 or argv[0] != "--timeout":
        raise SystemExit("usage: python.py --timeout <seconds> <arguments of unittest>")
    seconds = argv[1]
    TimedResult.timeout = float(seconds)

    def expired(signum, frame):
        raise AssertionError(f"the test outlived its timeout of {seconds}s")

    signal.signal(signal.SIGALRM, expired)
    unittest.main(module=None, argv=["unittest", *argv[2:]], testRunner=TimedRunner)


if __name__ == "__main__":
    # The process is up before it loads a test: the line tells run-tests to bound the gaps by the test timeout from here, and
    # not by the start-up bound (K549). The text is PROCESS_UP of scripts/kit/test-gap.mts.
    sys.stderr.write("kit-test-process-up\n")
    sys.stderr.flush()
    # The runner is started by runpy with its path as argv[1]: its own arguments follow it (K371).
    main(sys.argv[2:])
