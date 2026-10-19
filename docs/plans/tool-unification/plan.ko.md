<!-- doc-id: plan-tool-unification -->
<!-- source-sha256: fcccdf8ea105fb747fd412626b59833a72a08bdbbc5a1058c7bdd4dc9549778e -->
# 도구 통합

[English](plan.md)

## 목표

polyspec 저장소들의 공유 tool(release, push gate, Git hook, holder lock, document check, owner check, test runner, CI
report, toolchain install, dependency review와 gate)은 kit에 한 번만 존재하고, 모든 저장소가 package `@polyspec/kit`에서
그것을 실행한다.

## 원인

각 저장소가 각 tool의 사본을 TypeScript나 Python으로 따로 가졌고, 사본들은 동작과 결함이 서로 달라졌다.
[tool inventory](../../tool-inventory.ko.md)는 각 사본이 있던 곳, 크기, kit이 기반으로 삼은 구현을 기록한다.

## 결정

- tool은 구현들의 더 넓은 동작을 취하고 kit test로 고정한 뒤, 모든 사본을 kit의 tool로 바꾸어 병합한다. 취하거나 버린
  동작은 tool inventory에 기록한다.
- 저장소마다 다른 값은 kit의 schema를 가진 `config/<name>.json`의 data이고, code는 같다.

## 순서

checklist는 항목을 순서대로 나열한다. inventory가 먼저이고, 다음이 각 tool, 그다음이 저장소들의 전환이다.

## Exit criteria

checklist의 모든 항목이 done 또는 impossible이다. 모든 저장소가 kit의 tool을 실행하고 자기 사본을 갖지 않는다.
