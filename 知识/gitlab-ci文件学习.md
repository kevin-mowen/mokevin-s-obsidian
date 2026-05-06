## GitLab CI/CD 配置文件详解

是的，Runner 就是根据 `.gitlab-ci.yml` 的定义来执行任务的。

---

### 核心概念

```
Pipeline（流水线）
    │
    ├── Stage 1: build（阶段）
    │       └── Job A（任务）
    │
    ├── Stage 2: test
    │       ├── Job B
    │       └── Job C  ← 同一 Stage 的 Job 并行执行
    │
    └── Stage 3: deploy
            └── Job D
```

- **Pipeline**：一次完整的 CI/CD 流程，由 push/merge 触发
- **Stage**：阶段，按顺序执行，前一个失败后面不执行
- **Job**：具体任务，同一 Stage 内的 Job 并行执行

---

### 基础结构

```yaml
# 定义阶段顺序
stages:
  - build
  - test
  - deploy

# 定义 Job
job-name:
  stage: build        # 属于哪个阶段
  script:             # 要执行的命令
    - echo "Hello"
    - npm install
```

---

### 常用关键字详解

#### 1. `stages` - 定义阶段

```yaml
stages:
  - build
  - test
  - deploy
```

阶段按顺序执行。如果不定义，默认有 `build`、`test`、`deploy` 三个阶段。

---

#### 2. `script` - 执行命令（必填）

```yaml
test-job:
  script:
    - echo "Running tests"
    - npm test
    - echo "Done"
```

---

#### 3. `image` - 指定 Docker 镜像

```yaml
# 全局默认镜像
default:
  image: node:18

# 单个 Job 指定镜像
build-job:
  image: maven:3.8
  script:
    - mvn package

python-job:
  image: python:3.11
  script:
    - pip install -r requirements.txt
    - python test.py
```

---

#### 4. `before_script` / `after_script` - 前置/后置命令

```yaml
default:
  before_script:
    - echo "Job 开始"
  after_script:
    - echo "Job 结束（无论成功失败都执行）"

test-job:
  script:
    - npm test
```

---

#### 5. `variables` - 定义变量

```yaml
# 全局变量
variables:
  APP_NAME: "my-app"
  VERSION: "1.0.0"

build-job:
  # Job 级变量
  variables:
    BUILD_TYPE: "release"
  script:
    - echo "Building $APP_NAME version $VERSION"
    - echo "Build type: $BUILD_TYPE"
```

---

#### 6. `only` / `except` / `rules` - 控制 Job 何时运行

**方式一：only/except（旧版，简单场景）**

```yaml
# 只在 main 分支运行
deploy-job:
  only:
    - main
  script:
    - echo "Deploying..."

# 除了 develop 分支都运行
test-job:
  except:
    - develop
  script:
    - npm test
```

**方式二：rules（推荐，更灵活）**

```yaml
deploy-job:
  script:
    - echo "Deploying..."
  rules:
    # main 分支自动运行
    - if: $CI_COMMIT_BRANCH == "main"
      when: always
    # 其他分支手动触发
    - if: $CI_COMMIT_BRANCH != "main"
      when: manual
    # 合并请求时运行
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

---

#### 7. `when` - 控制运行时机

```yaml
stages:
  - build
  - test
  - cleanup

build-job:
  stage: build
  script:
    - npm run build

test-job:
  stage: test
  script:
    - npm test
  when: on_success      # 默认：前面成功才运行

manual-deploy:
  stage: deploy
  script:
    - ./deploy.sh
  when: manual          # 手动点击才运行

cleanup-job:
  stage: cleanup
  script:
    - rm -rf temp/
  when: always          # 无论成功失败都运行
```

`when` 可选值：

- `on_success`（默认）- 前面都成功才运行
- `on_failure` - 前面有失败才运行
- `always` - 总是运行
- `manual` - 手动触发
- `never` - 从不运行

---

#### 8. `needs` - 跳过阶段顺序（DAG）

```yaml
stages:
  - build
  - test
  - deploy

build-frontend:
  stage: build
  script:
    - npm run build:frontend

build-backend:
  stage: build
  script:
    - npm run build:backend

# 不等 build 全部完成，只要 build-frontend 完成就开始
test-frontend:
  stage: test
  needs: ["build-frontend"]
  script:
    - npm run test:frontend

deploy:
  stage: deploy
  needs: ["test-frontend", "build-backend"]
  script:
    - ./deploy.sh
```

---

#### 9. `artifacts` - 保存产物

```yaml
build-job:
  stage: build
  script:
    - npm run build
  artifacts:
    paths:
      - dist/           # 保存 dist 目录
      - build.log
    expire_in: 1 week   # 保留时间

test-job:
  stage: test
  script:
    - ls dist/          # 可以访问上一步的产物
    - npm test
```

---

#### 10. `cache` - 缓存依赖（加速构建）

```yaml
# 全局缓存
cache:
  key: ${CI_COMMIT_REF_SLUG}
  paths:
    - node_modules/
    - .npm/

install-job:
  script:
    - npm ci

test-job:
  script:
    - npm test    # 复用 node_modules 缓存
```

---

#### 11. `tags` - 指定 Runner

```yaml
# 指定带有 docker 标签的 Runner
build-job:
  tags:
    - docker
  script:
    - docker build -t my-app .

# 指定带有 gpu 标签的 Runner
ml-job:
  tags:
    - gpu
  script:
    - python train.py
```

---

#### 12. `services` - 启动附加服务

```yaml
test-job:
  image: python:3.11
  services:
    - name: postgres:15
      alias: db
    - name: redis:7
      alias: cache
  variables:
    POSTGRES_DB: test_db
    POSTGRES_USER: test
    POSTGRES_PASSWORD: test
    DATABASE_URL: "postgresql://test:test@db:5432/test_db"
  script:
    - pip install -r requirements.txt
    - pytest
```

---

#### 13. `environment` - 定义部署环境

```yaml
deploy-staging:
  stage: deploy
  script:
    - ./deploy.sh staging
  environment:
    name: staging
    url: https://staging.example.com

deploy-production:
  stage: deploy
  script:
    - ./deploy.sh production
  environment:
    name: production
    url: https://example.com
  when: manual
```

---

### 完整实战示例

#### Node.js 项目

```yaml
stages:
  - install
  - test
  - build
  - deploy

default:
  image: node:18-alpine

cache:
  key: ${CI_COMMIT_REF_SLUG}
  paths:
    - node_modules/

variables:
  npm_config_cache: "$CI_PROJECT_DIR/.npm"

# 安装依赖
install:
  stage: install
  script:
    - npm ci
  artifacts:
    paths:
      - node_modules/
    expire_in: 1 hour

# 代码检查
lint:
  stage: test
  script:
    - npm run lint

# 单元测试
unit-test:
  stage: test
  script:
    - npm run test:unit
  coverage: '/Lines\s*:\s*(\d+.?\d*)%/'
  artifacts:
    reports:
      junit: junit.xml

# 构建
build:
  stage: build
  script:
    - npm run build
  artifacts:
    paths:
      - dist/
    expire_in: 1 week

# 部署到测试环境
deploy-staging:
  stage: deploy
  script:
    - echo "Deploying to staging..."
  environment:
    name: staging
    url: https://staging.example.com
  rules:
    - if: $CI_COMMIT_BRANCH == "develop"

# 部署到生产环境
deploy-production:
  stage: deploy
  script:
    - echo "Deploying to production..."
  environment:
    name: production
    url: https://example.com
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: manual
```

---

#### Python 项目

```yaml
stages:
  - test
  - build
  - deploy

default:
  image: python:3.11

variables:
  PIP_CACHE_DIR: "$CI_PROJECT_DIR/.pip-cache"

cache:
  paths:
    - .pip-cache/
    - venv/

before_script:
  - python -m venv venv
  - source venv/bin/activate
  - pip install -r requirements.txt

lint:
  stage: test
  script:
    - pip install flake8
    - flake8 src/

test:
  stage: test
  services:
    - postgres:15
  variables:
    POSTGRES_DB: test
    POSTGRES_USER: test
    POSTGRES_PASSWORD: test
  script:
    - pytest --cov=src tests/
  coverage: '/TOTAL.*\s+(\d+%)/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage.xml

build:
  stage: build
  script:
    - pip install build
    - python -m build
  artifacts:
    paths:
      - dist/
```

---

#### Docker 构建示例

```yaml
stages:
  - build
  - test
  - deploy

variables:
  IMAGE_NAME: $CI_REGISTRY_IMAGE
  IMAGE_TAG: $CI_COMMIT_SHORT_SHA

build-image:
  stage: build
  image: docker:24
  services:
    - docker:24-dind
  script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
    - docker build -t $IMAGE_NAME:$IMAGE_TAG .
    - docker push $IMAGE_NAME:$IMAGE_TAG

test-image:
  stage: test
  image: docker:24
  services:
    - docker:24-dind
  script:
    - docker run --rm $IMAGE_NAME:$IMAGE_TAG npm test

deploy:
  stage: deploy
  script:
    - echo "Deploying $IMAGE_NAME:$IMAGE_TAG"
  when: manual
```

---

### 内置变量（常用）

|变量|说明|
|---|---|
|`$CI_COMMIT_SHA`|完整 commit hash|
|`$CI_COMMIT_SHORT_SHA`|短 commit hash（8位）|
|`$CI_COMMIT_BRANCH`|分支名|
|`$CI_COMMIT_MESSAGE`|commit 信息|
|`$CI_PROJECT_NAME`|项目名|
|`$CI_PROJECT_DIR`|项目目录|
|`$CI_PIPELINE_ID`|Pipeline ID|
|`$CI_JOB_ID`|Job ID|
|`$CI_REGISTRY`|容器仓库地址|
|`$CI_REGISTRY_IMAGE`|项目镜像地址|

完整列表：[GitLab 预定义变量](https://docs.gitlab.com/ee/ci/variables/predefined_variables.html)

---

### 调试技巧

```yaml
debug-job:
  script:
    # 打印所有环境变量
    - env | sort
    # 打印当前目录结构
    - ls -la
    # 查看 Git 信息
    - git log --oneline -5
```

---

需要我针对某个具体场景写一个完整的 `.gitlab-ci.yml` 示例吗？