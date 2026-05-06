好的！我给你一个从零开始的 React 学习路线，重点讲清楚 Context 和 Provider。

---

## 学习路线图

```
第一阶段：前置知识
    ↓
第二阶段：React 基础
    ↓
第三阶段：React 状态管理（Context/Provider）
    ↓
第四阶段：进阶内容
```

---

## 第一阶段：前置知识

在学 React 之前，需要掌握：

```javascript
// 1. ES6 基础语法

// 箭头函数
const add = (a, b) => a + b;

// 解构赋值
const { name, age } = user;
const [first, second] = array;

// 展开运算符
const newArray = [...oldArray, newItem];
const newObj = { ...oldObj, newProp: value };

// 模板字符串
const greeting = `Hello, ${name}!`;

// import/export
import { useState } from 'react';
export default MyComponent;
```

---

## 第二阶段：React 基础

### 1. 组件是什么？

组件就是一个**返回 HTML 的函数**：

```tsx
// 最简单的组件
const Hello = () => {
  return <h1>你好，世界！</h1>;
};

// 使用组件
<Hello />
```

### 2. Props（属性传递）

父组件向子组件传递数据：

```tsx
// 子组件：接收 props
const Greeting = ({ name, age }: { name: string; age: number }) => {
  return <p>我是 {name}，今年 {age} 岁</p>;
};

// 父组件：传递 props
const App = () => {
  return <Greeting name="张三" age={20} />;
};
```

### 3. State（状态）

组件内部的数据，改变时会重新渲染：

```tsx
import { useState } from 'react';

const Counter = () => {
  // 声明一个状态：count，初始值是 0
  const [count, setCount] = useState(0);

  return (
    <div>
      <p>计数：{count}</p>
      <button onClick={() => setCount(count + 1)}>+1</button>
      <button onClick={() => setCount(count - 1)}>-1</button>
    </div>
  );
};
```

### 4. 事件处理

```tsx
const Button = () => {
  const handleClick = () => {
    alert('按钮被点击了！');
  };

  return <button onClick={handleClick}>点我</button>;
};
```

### 5. 条件渲染

```tsx
const Status = ({ isOnline }: { isOnline: boolean }) => {
  return (
    <div>
      {isOnline ? <span>🟢 在线</span> : <span>⚫ 离线</span>}
    </div>
  );
};
```

### 6. 列表渲染

```tsx
const TodoList = ({ items }: { items: string[] }) => {
  return (
    <ul>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
};

// 使用
<TodoList items={['学习', '吃饭', '睡觉']} />
```

---

## 第三阶段：Context 和 Provider（重点！）

### 问题：为什么需要 Context？

先看没有 Context 时的痛点——**Props 层层传递**：

```tsx
// ❌ 痛点：数据要一层层往下传（Props Drilling）

const App = () => {
  const [user, setUser] = useState({ name: '张三' });
  
  return <Layout user={user} />;  // 传给 Layout
};

const Layout = ({ user }) => {
  return <Sidebar user={user} />;  // 再传给 Sidebar
};

const Sidebar = ({ user }) => {
  return <UserInfo user={user} />;  // 再传给 UserInfo
};

const UserInfo = ({ user }) => {
  return <p>{user.name}</p>;  // 最终使用
};

// 问题：中间的 Layout、Sidebar 根本不需要 user
// 只是为了传递给下一层，很麻烦！
```

### 解决方案：Context

```
┌─────────────────────────────────────────┐
│  Context = 一个"广播站"                  │
│                                         │
│  Provider = 广播站发射信号               │
│  useContext = 收音机接收信号             │
└─────────────────────────────────────────┘
```

### 完整示例：一步步创建和使用 Context

```tsx
// 📁 UserContext.tsx

import { createContext, useContext, useState, ReactNode } from 'react';

// ========== 第 1 步：定义类型 ==========
type UserContextType = {
  user: { name: string } | null;
  login: (name: string) => void;
  logout: () => void;
};

// ========== 第 2 步：创建 Context ==========
const UserContext = createContext<UserContextType>({
  user: null,
  login: () => {},
  logout: () => {}
});

// ========== 第 3 步：创建 Provider 组件 ==========
export const UserProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<{ name: string } | null>(null);

  const login = (name: string) => {
    setUser({ name });
  };

  const logout = () => {
    setUser(null);
  };

  // 把数据和方法通过 value 传出去
  return (
    <UserContext.Provider value={{ user, login, logout }}>
      {children}
    </UserContext.Provider>
  );
};

// ========== 第 4 步：创建 Hook 方便使用 ==========
export const useUser = () => {
  return useContext(UserContext);
};
```

```tsx
// 📁 App.tsx

import { UserProvider } from './UserContext';

// ========== 第 5 步：用 Provider 包裹整个应用 ==========
const App = () => {
  return (
    <UserProvider>
      <Layout />
    </UserProvider>
  );
};
```

```tsx
// 📁 任意深层组件.tsx

import { useUser } from './UserContext';

// ========== 第 6 步：任意组件直接使用 ==========
const UserInfo = () => {
  // 直接获取，不需要 props 传递！
  const { user, login, logout } = useUser();

  if (!user) {
    return <button onClick={() => login('张三')}>登录</button>;
  }

  return (
    <div>
      <p>欢迎，{user.name}！</p>
      <button onClick={logout}>退出</button>
    </div>
  );
};
```

### 图示对比

```
❌ 没有 Context（层层传递）：

App (user) 
  → Layout (user)      ← 不需要但必须接收
    → Sidebar (user)   ← 不需要但必须接收  
      → UserInfo (user) ← 真正使用


✅ 有 Context（直接获取）：

App
  └── UserProvider ← 提供数据
        │
        ├── Layout        ← 不用管 user
        │     └── Sidebar ← 不用管 user
        │           └── UserInfo ← 直接 useUser() 获取！
        │
        └── 其他任意组件   ← 也能直接 useUser() 获取！
```

---

## 第四阶段：更多 Hooks

```tsx
// 1. useState - 状态
const [count, setCount] = useState(0);

// 2. useEffect - 副作用（请求数据、订阅等）
useEffect(() => {
  fetchData();
}, []);  // 空数组 = 只在组件挂载时执行一次

// 3. useContext - 获取 Context
const value = useContext(MyContext);

// 4. useRef - 引用 DOM 元素
const inputRef = useRef<HTMLInputElement>(null);
<input ref={inputRef} />
inputRef.current?.focus();

// 5. useMemo - 缓存计算结果
const expensiveValue = useMemo(() => computeExpensive(a, b), [a, b]);

// 6. useCallback - 缓存函数
const handleClick = useCallback(() => {
  doSomething(a);
}, [a]);
```

---

## 推荐学习资源

|类型|推荐|
|---|---|
|官方文档|[react.dev](https://react.dev/)（新版，强烈推荐）|
|中文教程|[React 官方中文文档](https://zh-hans.react.dev/)|
|视频|B站搜索"React 入门"|
|练手项目|Todo App → 简单博客 → 后台管理系统|

---

## 学习建议

1. **先动手**：每学一个概念，立刻写代码试试
2. **从简单开始**：先做 Todo App，把基础概念用熟
3. **遇到不懂的**：随时问我，我帮你解释

要不要我给你写一个完整的小项目示例（比如 Todo App），把这些概念都串起来？