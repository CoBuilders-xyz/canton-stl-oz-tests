import { inspect } from "node:util";

function errorDetails(error) {
  return inspect(error, { depth: null, colors: false, customInspect: false, maxArrayLength: null, maxStringLength: null })
    .split("\n").map((line) => `    ${line}`).join("\n") + "\n";
}

export default async function* reporter(events) {
  let scenario;
  let failedRun = false;
  let hookFailures = 0;
  const scenarios = { COMPLETE: 0, PARTIAL: 0, FAILED: 0 };
  function failRun() {
    failedRun = true;
    // Node 24.10 can report suite after-hook failures without setting a failing exit code.
    if (process.exitCode === undefined || Number(process.exitCode) === 0) process.exitCode = 1;
  }

  for await (const { type, data } of events) {
    // Original scenarios are suites directly inside the shared Sandbox suite.
    if (type === "test:start") {
      if (data.nesting === 1) scenario = { name: data.name, checks: [] };
      else if (scenario && data.nesting > 1) scenario.checks.push({ name: data.name, nesting: data.nesting });
    } else if (type === "test:pass" || type === "test:fail") {
      const failed = type === "test:fail";
      if (failed) failRun();
      if (data.details.error?.failureType === "hookFailed") hookFailures++;

      if (data.nesting === 1 && data.details.type === "suite") {
        const checks = scenario?.checks ?? [];
        const unknown = checks.length === 0 || checks.some((check) => !check.result);
        const status = failed || unknown || checks.some((check) => check.failed) ? "FAILED"
          : data.skip || data.todo || checks.some((check) => check.result.skip || check.result.todo) ? "PARTIAL" : "COMPLETE";
        scenarios[status]++;
        if (status === "FAILED") failRun();
        yield `${data.name} [${status}]\n`;
        for (const check of checks) {
          if (check.result?.details.type === "suite" && !check.failed) continue;
          const result = check.result;
          const prefix = check.failed || !result ? "✖" : result.skip ? "﹣ SKIP:" : result.todo ? "﹣ TODO:" : "✔";
          const label = check.name.startsWith("Not checked: ") ? check.name.slice("Not checked: ".length) : check.name;
          yield `${"  ".repeat(check.nesting - 1)}${prefix} ${label}\n`;
          if (result?.details.error) yield errorDetails(result.details.error);
          if (!result) yield "    No outcome was reported for this check.\n";
        }
        if (unknown) yield "  ✖ Incomplete check results\n";
        if (data.details.error) yield errorDetails(data.details.error);
        yield "\n";
        scenario = undefined;
      } else if (scenario && data.nesting > 1) {
        let check = scenario.checks.findLast((entry) => entry.nesting === data.nesting && entry.name === data.name && !entry.result);
        if (!check) {
          check = { name: data.name, nesting: data.nesting };
          scenario.checks.push(check);
        }
        check.result = data;
        check.failed = failed;
      } else if (failed) {
        yield `FAILED outside scenario: ${data.name}\n${errorDetails(data.details.error)}\n`;
      }
    } else if (type === "test:stdout" || type === "test:stderr") {
      yield data.message;
    } else if (type === "test:summary" && data.file === undefined) {
      if (!data.success) failRun();
      const counts = data.counts;
      yield `Scenarios: ${Object.values(scenarios).reduce((sum, count) => sum + count, 0)} | COMPLETE ${scenarios.COMPLETE} | PARTIAL ${scenarios.PARTIAL} | FAILED ${scenarios.FAILED}\n`;
      yield `Checks: ${counts.tests} | PASS ${counts.passed} | SKIP ${counts.skipped} | FAIL ${counts.failed} | CANCELLED ${counts.cancelled} | TODO ${counts.todo}\n`;
      if (hookFailures) yield `Hook failures: ${hookFailures}\n`;
      yield `Run: ${data.success && !failedRun ? "PASSED" : "FAILED"}\n`;
    }
  }
}
