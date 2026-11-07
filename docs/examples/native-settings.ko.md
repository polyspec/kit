<!-- doc-id: example-native-settings -->
<!-- source-sha256: d6bcdb4c3fd7b4b61fc01684638b2f781b13d84f43bdd73f1dbe3f70fcb5c43b -->
# 예제: 네이티브 설정

[English](native-settings.md)

저장소는 도구의 설정을 그 도구 자신의 파일에 적고, 각 도구는 문서에 적힌 대로 그것을 읽는다. kit은 그중 어느 것도 정하지 않는다. 이 문서는 작동하는 방법 하나를 보여 준다. 복사하거나, 바꾸거나, 무시하면 된다.

## npm: `.npmrc`

npm 12는 프로젝트가 허용하지 않으면 URL 의존성을 거부한다(`allow-remote`, 기본값 `none`). `package-lock.json`이 `@polyspec/kit`이나 다른 패키지를 release asset의 URL로 고정하는 저장소는 자기 `package.json`이 적은 URL을 허용한다.

```ini
allow-remote=root
```

자기 의존성을 URL로 적는 제공 라이브러리를 설치하는 저장소는 그것들도 허용한다.

```ini
allow-remote=all
```

npm은 모든 `npm ci`와 `npm install`에서 프로젝트 루트의 `.npmrc`를 읽는다. 다른 폴더에서 실행한 `npm --prefix <root> ci`도 마찬가지다.

## mise와 uv: `mise.toml`

mise는 `mise.toml`의 `[settings]`를 읽고, mise가 실행하는 도구는 `[env]`를 받는다. `mise.lock`이 고정한 것만 설치·실행하고 스스로 설치하지 않으며, uv가 Python을 내려받지 않고, home의 managed Python보다 mise의 Python(PATH 앞의 shim)을 먼저 쓰며, cache를 checkout 안에 두는 저장소는 다음처럼 적는다.

```toml
[settings]
locked = true
auto_install = false

[env]
UV_PYTHON_DOWNLOADS = "never"
UV_PYTHON_PREFERENCE = "only-system"
UV_NO_CONFIG = "1"
UV_CACHE_DIR = "{{config_root}}/var/tools/mise/cache/uv"
```

자기 `uv.toml`을 가진 저장소는 `UV_NO_CONFIG`를 빼야 한다. 그 값은 uv가 그 파일도 읽지 않게 하기 때문이다.

## lint 도구: 도구 자신의 설정 파일

각 lint 도구는 자기 규칙대로 저장소에서 설정을 읽는다. kit이 자신에게 쓰는 규칙을 원하는 저장소는 kit의 파일을 복사하고 필요한 대로 바꾼다. 대부분의 도구는 lint하는 폴더에서 위로 설정을 찾는다. PHPStan은 패키지 폴더만 읽으므로, 패키지 폴더에 설정이 없으면 lint-php가 루트의 `phpstan.dist.neon`을 넘긴다.

| 도구 | 파일 | kit 자신의 파일 |
|---|---|---|
| ruff | `ruff.toml` 또는 `pyproject.toml`의 `[tool.ruff]` | [`ruff.toml`](../../ruff.toml) |
| vulture | 패키지 `pyproject.toml`의 `[tool.vulture]` | — |
| phpcs, PHPStan | `phpcs.xml.dist`, `phpstan.dist.neon` | [`phpcs.xml.dist`](../../phpcs.xml.dist), [`phpstan.dist.neon`](../../phpstan.dist.neon) |
| golangci-lint | `.golangci.yml` | [`.golangci.yml`](../../.golangci.yml) |
| clippy | `Cargo.toml`의 `[lints]`, `clippy.toml` | [`clippy.toml`](../../clippy.toml) |
| oxlint, knip | `.oxlintrc.json`, `knip.json` | [`.oxlintrc.json`](../../.oxlintrc.json), [`knip.json`](../../knip.json) |

경고와 오류를 숨기는 lint를 거부하는 Cargo workspace는 다음처럼 적는다.

```toml
[workspace.lints.rust]
warnings = "deny"
unsafe_code = "deny"
unused_must_use = "deny"

[workspace.lints.clippy]
all = { level = "deny", priority = -1 }
allow_attributes_without_reason = "deny"
let_underscore_must_use = "deny"
let_underscore_untyped = "deny"
map_err_ignore = "deny"
```

oxlint는 `error`로 정한 규칙에서 실패한다. `.oxlintrc.json`의 `"categories": { "correctness": "error" }`는 모든 correctness 지적을 실패로 만든다.
