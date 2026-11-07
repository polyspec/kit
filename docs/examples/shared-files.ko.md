<!-- doc-id: example-shared-files -->
<!-- source-sha256: 740b3490b7865d5148430dedd8e805ac73ccacbe062163bb2102c9e0791bfce2 -->
# 예제: 공유 파일

[English](shared-files.md)

package `@polyspec/kit`은 kit이 스스로 쓰고 저장소가 가져갈 수 있는 파일을 담습니다. kit은 그중 어느 것도 저장소에 쓰지 않으며 사본을 비교하지도 않습니다(K1052). 저장소는 원하는 것을 `node_modules/@polyspec/kit/`에서 복사하고, 각 사본을 자기 파일로 commit하며, 필요한 대로 고칩니다.

| package의 파일 | 저장소가 사본을 두는 곳 | 하는 일 |
|---|---|---|
| `workflows/ci-pipeline.yml` | `.github/workflows/ci-pipeline.yml` | 저장소의 `ci.yml`이 job으로 호출하는 CI 파이프라인. 마지막 `required` job은 plan이 고른 job이 성공하지 않으면 실패합니다 |
| `workflows/release.yml` | `.github/workflows/release.yml` | `main`의 CI 실행이 통과한 뒤 시작하는 release workflow |
| `actions/kit-bootstrap/action.yml` | `.github/actions/kit-bootstrap/action.yml` | CI job의 bootstrap: `mise.toml`의 Node.js, lock된 kit, var/tools의 npm과 package |
| `config/layout.kit.yml`, `config/composer.schema.json` | `config/` | `config/layout.yml`이 extends하는 공통 alint 규칙 |
| `.editorconfig` | `.editorconfig` | kit의 editor 설정 |
| `PRINCIPLES.md`, `PRINCIPLES.ko.md` | root | 저장소의 AGENTS.md가 link하는 작업 원칙 |

사본은 저장소의 파일입니다. 예시의 나중 변경은 저장소가 원할 때 받으며, 예를 들어 `cp`로 복사하고 차이를 commit합니다.

```sh
cp node_modules/@polyspec/kit/workflows/release.yml .github/workflows/release.yml
git diff .github/workflows/release.yml
```

workflow는 자기가 실행하는 make target(`kit-ci-plan`, `kit-ci-setup`, `ci-targets`, `kit-gates-*`, `release-*`)을 이름으로 부릅니다. workflow를 복사하는 저장소는 그 target을 정의하거나 workflow를 고칩니다.
