<!-- doc-id: operations-release-structure -->
<!-- source-sha256: f4fc91eea3d0b0726b51aadcb246aec20a0f7d3888306b6e993aeb257f9914ca -->
# 릴리스 구조

[English](release-structure.md)

K194의 검토입니다. kit이 그것을 쓰는 저장소에 어떻게 닿는지, kit의 변경이 그 저장소들에 무엇을 치르게 하는지, 그리고 각 부분이 앞으로
가질 구조를 다룹니다. 2026-10-23 완료 작업 뒤 kit 0.0.54의 상태를 읽습니다.

## 지금 kit의 변경이 치르게 하는 것

kit은 규칙, 도구, 설정, bootstrap에 하나의 버전을 가진 npm 패키지 하나 `@polyspec/kit`입니다. 0.0.x에서 모든 저장소는 그 옆의 kit
checkout으로 패키지를 link하므로(`make link`, docs/operations/local-links.md), 도구나 규칙의 변경은 릴리스 없이 `dist/`를 통해 모든
저장소에 한 번에 닿습니다. 두 종류의 변경은 여전히 모든 저장소에 한 단계를 치르게 합니다.

- `make kit-sync`가 각 저장소에 복사하는 파일(package.json의 `kit.copies`)의 변경: 모든 저장소에 kit-sync 행이 필요하고, 아니면
  거기서 kit-check가 실패합니다. 2026-10-23에 `scripts/kit/bootstrap/install-mise.mts`의 한 줄(K532)이 kit-sync 행 일곱 개를 치르게
  했습니다.
- consumer가 경로로 extends하거나 이름 붙이는 파일의 변경, 그 경로가 바뀔 때: crudui의 `api-extractor.json` 일곱 개는 C17.11과
  C17.11-1까지 은퇴한 사본 `config/api-extractor.kit.json`을 extends했습니다.

K514는 이미 lint 설정을 사본에서 빼냈습니다. 각 lint는 설정을 패키지에서 읽으므로(`kitFile`), lint 설정의 변경은 어느 저장소에도 아무것도
치르게 하지 않습니다.

## 도구가 저장소에 그것을 필요로 하는지에 따른 사본

| 사본 | 저장소에 필요 | 구조 |
| --- | --- | --- |
| `scripts/kit/kit-bootstrap.mk`, `scripts/kit/bootstrap/*.mts` (파일 9개) | 예: 패키지가 설치되기 전에 실행된다(`make install-tools TOOLS=npm`, `make install-packages`) | 안정된 bootstrap 층 |
| `.github/workflows/gates.yml`, `.github/workflows/release.yml` | 예: GitHub는 workflow를 저장소에서 읽는다 | kit의 재사용 workflow를 부르는 caller |
| `.claude/settings.json` | 예: Claude Code가 저장소에서 읽는다 | 사본 |
| `.editorconfig` | 예: 편집기가 저장소 루트에서 읽는다 | 사본 |
| `PRINCIPLES.md`, `PRINCIPLES.ko.md` | 아니오: 독자가 link로 따라가는 문서 | 패키지로 가는 link 문서 |
| `config/layout.kit.yml`, `config/commit-identity.json` | 아니오: kit의 도구만 읽는다 | K514처럼 패키지에서 읽음 |
| `config/pyproject.schema.json`, `config/composer.schema.json`, `config/cargo.schema.json` | 아니오: kit의 layout check만 읽는다 | K514처럼 패키지에서 읽음 |
| `config/php-lint/composer.json`, `composer.lock` | 아니오: install-tools가 PHP lint를 var/tools에 설치하려고 읽는다 | K514처럼 패키지에서 읽음 |

## 각 부분이 가질 구조

1. **안정된 bootstrap 층.** bootstrap 사본은 패키지가 있기 전에 실행되므로 사본으로 남고, 릴리스와 함께만 바뀝니다. 그 변경은 한 wave의
   릴리스에 묶여 그 wave에서 저장소마다 한 번 sync되며, 변경마다 sync되지 않습니다. 릴리스 사이에 bootstrap에 필요한 수정은 bootstrap이
   설치 뒤 부를 수 있는 곳마다 패키지 자신의 도구에 들어가므로, 사본은 그 내용을 유지합니다.
2. **참조로 쓰는 설정.** kit의 도구만 읽는 모든 파일은 K514가 lint에 하듯 패키지에서 읽습니다. `config/layout.kit.yml`,
   `config/commit-identity.json`, manifest schema 셋, PHP lint 프로젝트입니다. 설정을 extends하는 consumer는 사본이 아니라 패키지
   (`@polyspec/kit/config/...`)를 이름 붙입니다(C17.11-1).
3. **도구가 요구하는 곳에만 사본.** 남는 사본은 표에서 도구가 저장소에서 읽는 것들입니다. bootstrap 층, `.claude/settings.json`,
   `.editorconfig`입니다. 두 workflow는 kit의 재사용 workflow를 부르는 얇은 caller가 되므로(`uses:
   polyspec/kit/.github/workflows/<name>.yml@<tag>`), 그 단계는 sync가 아니라 kit의 릴리스와 함께 바뀝니다. `PRINCIPLES.md`와 그
   쌍은 패키지로 가는 link 문서가 됩니다.
4. **묶은 릴리스.** 개발 변경은 릴리스 없이 link를 통해 저장소에 닿습니다. 릴리스는 한 wave의 행이 닫힌 뒤 의존 순서(kit,
   ordered-json, orm, template, crudui, hyper, fsm, ssr)로 한 번 만들고, 각 저장소는 릴리스와 bootstrap 층의 sync를 한 행에서
   받습니다(K438). 0.0.x에서 link된 동안 저장소는 릴리스를 pin하지 않습니다.

## 이 검토가 여는 행

2번과 3번의 이동은 각각 kit-sync가 쓰는 것을 바꾸므로 다음 릴리스의 묶은 sync를 거치는, K438 뒤의 kit 행입니다. kit 전용 설정 네 종류를
패키지에서 읽기, caller와 함께 재사용 workflow, principles의 link 문서입니다. 1번은 릴리스 절차(docs/operations/release.md)의
규칙입니다.

## 현재 package bootstrap (K671)

소비자는 설치된 `@polyspec/kit` package의 bootstrap을 include합니다. 첫 Make 실행 전에 native npm이 lock의 package를 설치합니다. 공유 principles, editor와 Claude 설정, release/gates workflow는 kit-sync가 관리하고 kit-check가 검사하는 일반 사본입니다. 옆의 source checkout은 선택 사항이며 native `npm link ../kit`으로 연결할 수 있습니다. 이 동작은 아래에 기록된 sibling bootstrap과 추적된 공유 link를 대체합니다.

## K614이 한 일

2026-10-25 사용자가 kit-sync 복사본의 제거를 승인했고, K614이 local 개발 checkout의 단순 symbolic link로 그것을 실행합니다.

- bootstrap 층은 복사본이 아닙니다. 저장소는 `../kit/scripts/kit/kit-bootstrap.mk`를 include하고, 그것이 곁의
  `scripts/kit/bootstrap` installer를 실행합니다.
- PHP lint project `config/php-lint`는 실행되는 kit에서 읽습니다.
- `config/commit-identity.json`은 각 저장소의 선언이며, workflow처럼 kit-check가 더 비교하지 않는 그 저장소의 일반 파일입니다.
- `PRINCIPLES.md`, 그 짝, `.editorconfig`, `.claude/settings.json`은 `../kit`의 파일로 가는 tracked symbolic link입니다.
- 두 workflow는 GitHub가 symbolic link를 따르지 않으므로 각 저장소의 일반 파일로 남고, kit-check는 더 비교하지 않습니다.
- `config/layout.kit.yml`과 그것이 이름 붙인 manifest schema 세 개는 kit-check가 비교하는 복사본으로 남습니다. alint 0.18.2가
  kit에서 읽는 모든 방법을 거부합니다. 저장소 밖의 `extends:`는 "`extends:` target … resolves to … which is outside the lint
  root"로, 그 파일로 가는 symbolic link도 같은 오류로, 두 번째 `--config`는 "`--config` may be given at most once"로 실패합니다.
