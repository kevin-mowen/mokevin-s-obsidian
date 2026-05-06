
## GitLab Runner 配置完整步骤

### 前提条件

已使用 docker-compose 启动 GitLab 和 GitLab Runner：

```yaml
version: "3.6"

services:
  gitlab:
    image: gitlab/gitlab-ce:latest
    container_name: gitlab
    restart: always
    hostname: localhost
    ports:
      - "80:80"
      - "443:443"
      - "22:22"
    volumes:
      - /Users/mokevin/opt/gitlab/config:/etc/gitlab
      - /Users/mokevin/opt/gitlab/logs:/var/log/gitlab
      - /Users/mokevin/opt/gitlab/data:/var/opt/gitlab

  gitlab-runner:
    image: gitlab/gitlab-runner:alpine
    container_name: gitlab-runner
    restart: always
    depends_on:
      - gitlab
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /Users/mokevin/opt/gitlab/gitlab-runner-config:/etc/gitlab-runner
```

---

### 步骤 1：确认网络名称

```bash
docker network ls
```

找到 `gitlab_default`（格式：`目录名_default`）

---

### 步骤 2：在 GitLab 创建 Runner

**Instance Runner（全局）：**

- Admin Area → CI/CD → Runners → New instance runner

**Project Runner（项目专用）：**

- 项目 → Settings → CI/CD → Runners → New project runner

配置选项：

- ✅ 勾选 **Run untagged jobs**
- 点击 **Create runner**
- **立即复制** `glrt-xxx` token（有效期很短）

---

### 步骤 3：注册 Runner

```bash
docker exec -it gitlab-runner gitlab-runner register \
  --non-interactive \
  --url "http://gitlab" \
  --token "glrt-xxx你的token" \
  --executor "docker" \
  --docker-image "alpine:latest" \
  --description "my-runner" \
  --docker-network-mode "gitlab_default"
```

---

### 步骤 4：修改配置文件（关键！）

必须添加 `clone_url`，否则 Job 容器无法 clone 代码：

```bash
docker exec -it gitlab-runner sh -c 'cat > /etc/gitlab-runner/config.toml << EOF
concurrent = 1
check_interval = 0
connection_max_age = "15m0s"
shutdown_timeout = 0

[session_server]
  session_timeout = 1800

[[runners]]
  name = "my-runner"
  url = "http://gitlab"
  token = "你的token"
  executor = "docker"
  clone_url = "http://gitlab"
  [runners.docker]
    image = "alpine:latest"
    network_mode = "gitlab_default"
    volumes = ["/var/run/docker.sock:/var/run/docker.sock", "/cache"]
EOF'
```

---

### 步骤 5：验证 Runner

```bash
docker exec -it gitlab-runner gitlab-runner list
docker exec -it gitlab-runner gitlab-runner verify
```

---

### 步骤 6：测试 CI/CD

在项目根目录创建 `.gitlab-ci.yml`：

```yaml
stages:
  - build
  - test

build-job:
  stage: build
  script:
    - echo "Building..."

test-job:
  stage: test
  script:
    - echo "Testing..."
```

Push 代码后在 **Build → Pipelines** 查看运行结果。

---

### 常用命令速查

|操作|命令|
|---|---|
|查看 Runner 列表|`docker exec -it gitlab-runner gitlab-runner list`|
|验证 Runner|`docker exec -it gitlab-runner gitlab-runner verify`|
|注销所有 Runner|`docker exec -it gitlab-runner gitlab-runner unregister --all-runners`|
|清空配置|`docker exec -it gitlab-runner sh -c "cat /dev/null > /etc/gitlab-runner/config.toml"`|
|重启 Runner|`docker restart gitlab-runner`|

---

### 关键点总结

1. **Token 有效期短** — 创建后立即使用
2. **必须配置 `clone_url = "http://gitlab"`** — 解决容器内 localhost 问题
3. **必须配置 `network_mode = "gitlab_default"`** — 让 Job 容器能访问 GitLab
4. **勾选 Run untagged jobs** — 否则没有 tag 的 Job 不会运行



