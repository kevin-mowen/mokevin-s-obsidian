---
title: Wire 自注册模式（PandaWiki 独特设计）
tags: [pandawiki, wire, 设计模式, echo, nats, 学习/阶段1]
aliases: [构造即注册, handler 自注册路由]
sources:
  - backend/cmd/api/wire.go
  - backend/cmd/api/wire_gen.go
  - backend/handler/v1/user.go
  - backend/handler/v1/provider.go
  - backend/handler/mq/rag.go
  - backend/handler/mq/provider.go
  - backend/server/http/http.go
  - scripts/wire-auto-register.sh
---

# Wire 自注册模式详解

> 项目最反常识的一个设计点。理解了它，才能理解为什么 `*App` 里大半字段都没人读。

## 一、先把"自注册"三个字拆开

- **Wire**：Google 出的依赖注入工具，编译期生成 `New` 函数的拓扑排序代码（`wire_gen.go`）。它本身只管"按依赖顺序 new 出对象"。
- **注册**：在框架（echo / NATS）的全局表里登记"这个 URL 走这个函数" / "这个 topic 走这个回调"。
- **自注册**：handler 在自己的构造函数里完成"注册"动作，不需要外部代码再来一遍 `e.GET("/...", h.Foo)`。

合起来：**Wire 实例化 handler 这件事本身就是写路由表**。

---

## 二、对比：标准 Web 项目怎么写

绝大多数 Go Echo 项目的写法：

```go
// handler/user.go
type UserHandler struct{ uc *UserUsecase }

func NewUserHandler(uc *UserUsecase) *UserHandler {
    return &UserHandler{uc: uc}                // ← 纯构造，没副作用
}

func (h *UserHandler) Login(c echo.Context) error  { /* ... */ }
func (h *UserHandler) GetInfo(c echo.Context) error { /* ... */ }
```

```go
// server/routes.go
func RegisterRoutes(e *echo.Echo, h *UserHandler) {
    g := e.Group("/api/v1/user")
    g.POST("/login", h.Login)                  // ← 在这里集中注册
    g.GET("",      h.GetInfo, AuthMW)
}
```

```go
// main.go
func main() {
    e := echo.New()
    userHandler := NewUserHandler(NewUserUsecase(...))
    RegisterRoutes(e, userHandler)             // ← 显式调用
    e.Start(":8080")
}
```

特征：
- `NewUserHandler` 是**纯函数**，只 new 对象、不写路由。
- 路由统一在 `routes.go` 集中登记。
- main 里能看到清晰的"创建对象 → 注册路由 → 启动"三段。

---

## 三、PandaWiki 怎么写

`backend/handler/v1/user.go:25-44`：

```go
type UserHandler struct {
    *handler.BaseHandler
    usecase *usecase.UserUsecase
    logger  *log.Logger
    config  *config.Config
    auth    middleware.AuthMiddleware
}

func NewUserHandler(
    e *echo.Echo,                              // ← 注意：构造函数收 echo
    baseHandler *handler.BaseHandler,
    logger *log.Logger,
    usecase *usecase.UserUsecase,
    auth middleware.AuthMiddleware,
    config *config.Config,
) *UserHandler {
    h := &UserHandler{
        BaseHandler: baseHandler,
        logger:      logger.WithModule("handler.v1.user"),
        usecase:     usecase,
        auth:        auth,
        config:      config,
    }

    // ↓↓↓ 这就是"自注册"——构造函数里直接写路由表
    group := e.Group("/api/v1/user")
    group.POST("/login", h.Login)
    group.GET("",  h.GetUserInfo, h.auth.Authorize)
    group.GET("/list", h.ListUsers, h.auth.Authorize)
    group.POST("/create", h.CreateUser, h.auth.Authorize,
        h.auth.ValidateUserRole(consts.UserRoleAdmin))
    group.PUT("/update", h.UpdateUser, h.auth.Authorize,
        h.auth.ValidateUserRole(consts.UserRoleAdmin))
    group.PUT("/reset_password", h.ResetPassword, h.auth.Authorize)
    group.DELETE("/delete", h.DeleteUser, h.auth.Authorize,
        h.auth.ValidateUserRole(consts.UserRoleAdmin))

    return h
}
```

特征：
- `NewUserHandler` 不再是纯函数，**每次被调用都会修改 echo 的全局路由表**。
- 没有 `routes.go`，没有"集中登记"那一步。
- main 里也没人显式调注册。

---

## 四、那 main 是怎么"启动路由"的？

`backend/cmd/api/main.go`：

```go
func main() {
    app, err := createApp()                    // (1)
    if err != nil { panic(err) }
    setup.CheckInitCert()
    port := app.Config.HTTP.Port
    app.HTTPServer.Echo.Start(fmt.Sprintf(":%d", port))   // (2)
}
```

只有两步：**(1) 装配 → (2) 启动**。中间没有"注册路由"那一步。

为什么不需要？看 `cmd/api/wire_gen.go` 里 `createApp()` 干了什么（节选）：

```go
func createApp() (*App, error) {
    // ... 一堆 New
    echo := http.NewEcho(logger, configConfig, ...)              // 创建 echo

    userUsecase, _ := usecase.NewUserUsecase(...)
    userHandler := v1.NewUserHandler(echo, baseHandler, logger,  // ← 这一行
        userUsecase, authMiddleware, configConfig)

    knowledgeBaseHandler := v1.NewKnowledgeBaseHandler(baseHandler,
        echo, knowledgeBaseUsecase, llmUsecase, ...)             // ← 又一行
    // ... 还有 16 行类似
    apiHandlers := &v1.APIHandlers{
        UserHandler:          userHandler,
        KnowledgeBaseHandler: knowledgeBaseHandler,
        // ...
    }
    // ...
    return &App{
        HTTPServer: httpServer,
        Handlers:   apiHandlers,                                 // ← 哑字段
        // ...
    }, nil
}
```

**关键**：`v1.NewUserHandler(echo, ...)` 这一行执行的瞬间，`POST /api/v1/user/login` 这条路由就已经登记到 `echo` 的全局路由表里了。当 `createApp()` 返回时，echo 已经攒齐了所有路由。`main()` 只要把 echo 启动起来即可。

那个 `apiHandlers := &v1.APIHandlers{...}` 在干啥？把 18 个 handler 实例塞进一个 struct 字段里。但 main 从来不读 `app.Handlers`——这个字段唯一的存在意义是：**强迫 Wire 把这些 handler 都 new 一遍**（如果没人持有它们，Wire 会优化掉）。

---

## 五、Consumer 端同理：构造即订阅

`backend/handler/mq/rag.go:35-47`：

```go
func NewRAGMQHandler(
    consumer mq.MQConsumer,
    logger *log.Logger,
    rag rag.RAGService,
    nodeRepo *pg.NodeRepository,
    kbRepo *pg.KnowledgeBaseRepository,
) (*RAGMQHandler, error) {
    h := &RAGMQHandler{
        consumer: consumer,
        logger:   logger.WithModule("mq.vector"),
        rag:      rag,
        nodeRepo: nodeRepo,
        kbRepo:   kbRepo,
    }

    // ↓↓↓ 构造时直接订阅 NATS topic
    if err := consumer.RegisterHandler(
        domain.VectorTaskTopic,
        h.HandleNodeContentVectorRequest,
    ); err != nil {
        return nil, err
    }
    return h, nil
}
```

跟 HTTP 完全同构：把 `e.Group(...).POST(...)` 换成 `consumer.RegisterHandler(...)`。Wire 调到这个构造函数时，订阅就已经登记到 mqConsumer 内部的 topic→callback 表里了。Consumer 的 main 只要调 `MQConsumer.StartConsumerHandlers(ctx)`，就会遍历这张表去 NATS 上订阅。

---

## 六、设计意图：为什么这样写

### 优点 1：路由 + handler 实现写在同一个文件，找东西不跨文件

要看 `/api/v1/user/login` 走什么逻辑？打开 `handler/v1/user.go` 一个文件全有了：上面 `group.POST("/login", h.Login)`，下面 `func (h *UserHandler) Login(...)`。不需要先看 routes.go 再跳到 user.go。

### 优点 2：消除"加了 handler 忘了注册路由"的 bug

标准写法里，新 handler 要改两个地方：handler 文件 + routes.go。漏一个就 404。本项目不需要 routes.go，handler 一定带路由。

### 优点 3：依赖关系强制清晰

`NewUserHandler` 入参里写明了它要 `auth middleware.AuthMiddleware`——Wire 会保证这个中间件先 new 出来再传进来。不存在"路由忘了挂中间件"的可能：因为路由就是 handler 自己挂的，缺中间件就编译不过。

### 优点 4：handler 注册顺序由 Wire 拓扑序决定，不会瞎并发

Wire 是单线程同步生成代码，所以所有 `NewXxxHandler` 顺序执行，echo 内部状态一直是干净的。

---

## 七、代价

### 代价 1：`*App` 里大半字段是"哑字段"

```go
type App struct {
    HTTPServer       *http.HTTPServer        // main 用
    Handlers         *v1.APIHandlers         // 哑字段
    ProHandlers      *prov1.ProAPIHandlers   // 哑字段
    ShareHandlers    *share.ShareHandler     // 哑字段
    OpenAPIHandlers  *openapi.OpenAPIHandlers // 哑字段
    Config           *config.Config          // main 用
    Logger           *log.Logger             // main 用
    Telemetry        *telemetry.Client       // 哑字段
}
```

读代码的人会困惑："`Handlers` 这字段哪用了？"答案是没用，副作用是它被 new 出来的过程中，路由全注册了。

### 代价 2：测试不友好

要单测一个 handler，必须给它一个 echo 实例，不然 `e.Group(...)` 第一行就 nil pointer。所以 handler 测试一般这样写：

```go
func TestUserHandler_Login(t *testing.T) {
    e := echo.New()
    h := NewUserHandler(e, baseHandler, logger, mockUsecase, mockAuth, cfg)
    // 现在 e 上已经有 /api/v1/user/login 这条路由了
    req := httptest.NewRequest(POST, "/api/v1/user/login", body)
    rec := httptest.NewRecorder()
    e.ServeHTTP(rec, req)
    // assert ...
}
```

构造函数本身有副作用，单测时没法只测某个方法。

### 代价 3：路由总览要 grep

想看"全部 admin 接口"得在 `handler/v1` 下 `grep -rn 'group.\(GET\|POST\|PUT\|DELETE\)'`。没有一份能一眼扫完的路由清单。

### 代价 4：路由排序敏感时不好控

echo 内部是按注册顺序匹配。如果两个 group 路径有交集（比如通配 `/foo/*` vs 精确 `/foo/bar`），它们的注册顺序由 Wire 拓扑序决定，你只能通过调整 ProviderSet 顺序来间接影响——很绕。

---

## 八、加一个新接口的完整步骤（最有用的实操）

假设要加 `GET /api/v1/foo/:id`：

### 步骤 1：写 usecase

`backend/usecase/foo.go`：

```go
type FooUsecase struct {
    repo *pg.FooRepo
}

func NewFooUsecase(repo *pg.FooRepo) *FooUsecase {
    return &FooUsecase{repo: repo}
}

func (u *FooUsecase) GetFoo(ctx context.Context, id string) (*domain.Foo, error) {
    return u.repo.Get(ctx, id)
}
```

### 步骤 2：注册 usecase 到 Provider

`backend/usecase/provider.go`：

```go
var ProviderSet = wire.NewSet(
    NewUserUsecase,
    NewKnowledgeBaseUsecase,
    // ...
    NewFooUsecase,        // ← 加这行
)
```

### 步骤 3：写 handler（自注册路由！）

`backend/handler/v1/foo.go`：

```go
type FooHandler struct {
    *handler.BaseHandler
    usecase *usecase.FooUsecase
    logger  *log.Logger
}

func NewFooHandler(
    e *echo.Echo,
    baseHandler *handler.BaseHandler,
    logger *log.Logger,
    usecase *usecase.FooUsecase,
    auth middleware.AuthMiddleware,
) *FooHandler {
    h := &FooHandler{
        BaseHandler: baseHandler,
        logger:      logger.WithModule("handler.v1.foo"),
        usecase:     usecase,
    }

    // ↓ 自注册路由
    group := e.Group("/api/v1/foo", auth.Authorize)
    group.GET("/:id", h.GetFoo)

    return h
}

func (h *FooHandler) GetFoo(c echo.Context) error {
    id := c.Param("id")
    foo, err := h.usecase.GetFoo(c.Request().Context(), id)
    if err != nil {
        return h.NewResponseWithError(c, "failed", err)
    }
    return h.NewResponseWithData(c, foo)
}
```

### 步骤 4：在 APIHandlers struct 加字段，并注册到 ProviderSet

`backend/handler/v1/provider.go`：

```go
type APIHandlers struct {
    UserHandler          *UserHandler
    KnowledgeBaseHandler *KnowledgeBaseHandler
    // ...
    FooHandler           *FooHandler        // ← 加这行（哑字段，但必需）
}

var ProviderSet = wire.NewSet(
    middleware.ProviderSet,
    usecase.ProviderSet,
    handler.NewBaseHandler,
    NewUserHandler,
    NewKnowledgeBaseHandler,
    // ...
    NewFooHandler,        // ← 加这行
    wire.Struct(new(APIHandlers), "*"),
)
```

### 步骤 5：重新生成 wire_gen.go

```bash
cd backend && make generate
```

或更省心：

```bash
bash scripts/wire-auto-register.sh   # 自动检测并补全 ProviderSet
cd backend && make generate
```

### 步骤 6：启动验证

```bash
bash ./scripts/dev-services-cl.sh    # 选 6 启动 API
curl http://dev.localhost:18000/api/v1/foo/123
```

> **最容易栽的坑**：步骤 4 的 ProviderSet 漏加 `NewFooHandler`。结果：
> - 编译通过 ✓
> - 进程启动 ✓
> - 访问 `/api/v1/foo/:id` 返回 404 ✗
>
> 因为 Wire 没调到 `NewFooHandler`，`e.Group("/api/v1/foo")` 这行从来没执行过。

---

## 九、模式对比：哪种好

| 维度 | 标准模式 | PandaWiki 自注册模式 |
|---|---|---|
| 路由总览 | 看 `routes.go` 一眼到位 | 要 grep |
| 加新 handler 步骤 | 改 2 处（handler + routes.go）| 改 2 处（handler + provider.go）|
| 漏改导致 404 | 容易（漏 routes.go 注册）| 容易（漏 ProviderSet 注册）|
| handler 单测 | 容易（构造无副作用）| 麻烦（要给 echo）|
| 中间件依赖 | 注册时挂载，可能漏 | 入参强制声明 |
| 主函数清晰度 | 三段："构造-注册-启动" | 两段："装配-启动"，注册被藏在装配里 |
| 心智负担 | 低（直观）| 高（要先理解副作用）|

**没有谁绝对好**。PandaWiki 这套适合：
- 团队稳定、人手熟悉项目
- 业务模块多（18 个 handler，集中 routes.go 也会很臃肿）
- 严格用 Wire 做 DI

---

## 十、四个 ProviderSet 都长一样

`backend/handler/v1/provider.go`（Admin 接口）：

```go
type APIHandlers struct {
    UserHandler          *UserHandler
    KnowledgeBaseHandler *KnowledgeBaseHandler
    NodeHandler          *NodeHandler
    // ... 共 18 个
}

var ProviderSet = wire.NewSet(
    middleware.ProviderSet,
    usecase.ProviderSet,
    handler.NewBaseHandler,
    NewNodeHandler,           // 18 个 New* 函数
    NewAppHandler,
    // ...
    wire.Struct(new(APIHandlers), "*"),
)
```

Share、Pro、OpenAPI、MQ 4 个 provider 文件都是这个形状。新增一类 handler 的工作就是套这个模板。

---

## 十一、易错点合集

- **忘了在 ProviderSet 注册新 handler**。Wire 不会调到 `New*Handler`，路由不会注册——访问就 404，编译却没报错。这是最坑的一种 bug。
- **构造函数返错**。`return nil, err` 时 Wire 的整条装配链会回滚，整个进程起不来；但路由可能已经部分注册了——echo 状态会脏。**所以 New 函数里要么不报错，要么在第一行就报，不要先注册路由再 return err**。
- **routes 顺序敏感时栽跟头**。echo 路由是按注册顺序匹配，Wire 装配的顺序你控制不了。如果两个 group 路径有交集，可能匹配到"错的"handler。
- **想在 main 里手动加路由**？拿不到 echo——它在 `app.HTTPServer.Echo` 里。原则上可以加：`app.HTTPServer.Echo.GET(...)`，但这条路违背了项目的设计语义。
- **不要 `go run cmd/api/main.go`**。这样会缺少 `wire_gen.go`，编译失败找不到 `createApp`。要 `go run ./cmd/api`。

---

## 十二、最简记忆方式

记住一句话：

> **`NewUserHandler(echo, ...)` 这行代码执行时，`/api/v1/user` 下面所有路由就已经存在于 echo 里了。Wire 的工作就是依次调用这些 New 函数，所有路由就被攒起来了。**

打开 `cmd/api/wire_gen.go`，最后那个 `app := &App{...}` 之前的代码读起来像是"装了一堆东西然后丢掉"。**就是这样**——副作用都已经发生在装的过程里了。

这就是"Wire 自注册模式"。

---

## 关联

- [[00-启动流程总览]]
- [[API进程启动链]]
- [[Consumer进程启动链]]
- [[后端分层]]
- [[Backend-API进程]]
- [[Backend-Consumer进程]]
