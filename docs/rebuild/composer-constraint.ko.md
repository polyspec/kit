<!-- doc-id: rebuild-composer-constraint -->
<!-- source-sha256: 30bae1eaf33cea0def8208217d63bf35b094bdb1ef739c4e507cf125e1f21ec2 -->
# 재구현 기록: composer-constraint

[English](composer-constraint.md)

판정: **맞는 도구 없음.** kit은 `composer-constraint.mts`를 유지합니다. `check-dependency-policy.mts`가 이 파일로 잠긴
Composer package의 `php`와 `ext-*` 요구사항을 판정합니다. 2026-10-21(K455)에 측정했습니다.

## 대상

- `scripts/kit/composer-constraint.mts`

## 요구사항

| 항목 | 요구사항 |
|---|---|
| C1 | `||`는 대안을 나누며, 대안 안에서 공백이나 쉼표로 나뉜 항은 모두 만족해야 합니다 |
| C2 | 항은 `^`, `~`, `>=`, `>`, `<=`, `<`, `=`, `==`, `!=` 연산자가 붙은 version, 연산자가 없는 version(정확히 일치), `8.4.*`이나 `*` 같은 wildcard입니다 |
| C3 | kit이 읽지 않는 형식(hyphen range, `@dev`, 안정성 flag)은 그 text와 함께 throw하여, 호출자가 판정하지 않고 보고하게 합니다 |
| C4 | 플랫폼 version(`php`, `ext-*`)은 잠긴 package의 constraint에 대해 판정합니다 |

## 평가한 도구

| 도구 | 상태 | 판정 |
|---|---|---|
| npm `semver` | 7.8.5(package.json의 pin) | `||`, `^`, `~`, 연산자, x-range를 Composer처럼 읽지만, Composer constraint에서 쓰는 `>=1.0,<2.0` 같은 쉼표 구분 AND 항에는 `null`을 반환합니다. 쉼표 형식은 semver 앞에서 다시 써야 하며, 그 다시 쓰기가 C1과 C3이 설명하는 parser 자체이므로 semver는 규칙을 대신하지 못하고 package만 더합니다 |
| `@renovatebot/pep440` | kit의 pin | Composer constraint가 아니라 Python의 PEP 440 specifier를 읽습니다 |
| npm에서 "composer constraint parser" 검색 (결과 20건) | 2026-10-21 | Composer constraint 문법을 읽는 결과가 없습니다. 결과는 범용 parser이며, @snyk/composer-lockfile-parser는 constraint가 아니라 composer.lock을 읽습니다 |
| `composer/semver`(PHP) | Composer의 library | Composer 문법을 정확히 읽지만 PHP에서만 실행됩니다. `check-dependency-policy`는 모든 저장소에서 실행되므로, PHP가 없는 저장소는 dependency gate를 위해 PHP runtime이 필요해집니다 |

## 맞는 도구가 없는 이유

Composer 문법을 읽는 library는 PHP뿐입니다. 이를 호출하면 모든 저장소의 Node dependency gate 안에 PHP process가 생기며,
PHP가 없는 저장소에 runtime을 추가하게 됩니다. npm `semver`는 C1이 요구하는 쉼표 형식을 잘못 읽으므로, 쓰려면 같은
parser인 다시 쓰기가 필요합니다. kit은 약 85줄인 parser를 유지하며, `tests/kit/dependency-policy.test.mts`로 시험합니다.

## 재시도 조건

Composer constraint 문법을 쉼표 구분 AND 항까지 포함해 읽는 Node package가 생기거나, `dependency-policy-check`를 실행하는 모든
저장소에 PHP가 설치되어 있게 되면 다시 검토합니다.
