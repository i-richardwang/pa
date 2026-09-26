/** OAuth 授权时未登录的用户会被重定向到这里；登录后 authClient 的 redirect 插件跳回授权端点继续授权。 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { authClient } from "./auth_client";

type LoginView = "gate" | "password";

/** redirect 参数用 URL 解析并校验同源：只判断前缀不够，浏览器会把 \ 和制表符规范化成 //host。 */
function safeRedirect(): string | null {
  const raw = new URLSearchParams(window.location.search).get("redirect");
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin === window.location.origin) return url.pathname + url.search;
  } catch {}
  return null;
}

function readView(): LoginView {
  return new URLSearchParams(window.location.search).get("view") === "password"
    ? "password"
    : "gate";
}

function writeView(view: LoginView) {
  const url = new URL(window.location.href);
  if (view === "password") url.searchParams.set("view", "password");
  else url.searchParams.delete("view");
  window.history.pushState({}, "", url);
}

function LoginFloatingField({
  label,
  type,
  value,
  onChange,
  autoComplete,
  inputRef,
  required,
  trailing,
}: {
  label: string;
  type: "email" | "password" | "text";
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  required?: boolean;
  trailing?: ReactNode;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const raised = focused || value.length > 0;

  return (
    <div className="relative w-full">
      <div
        className={cn(
          "flex h-13 w-full items-center rounded-auth border bg-pa-bg transition-colors",
          focused
            ? "border-pa-highlight shadow-[0_0_0_1px_var(--pa-highlight)]"
            : "border-pa-login-input-border",
        )}
      >
        <input
          ref={inputRef}
          id={id}
          type={type}
          autoComplete={autoComplete}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="h-full min-w-0 flex-1 bg-transparent px-4 text-base text-pa-fg outline-none"
        />
        {trailing}
      </div>
      <label
        htmlFor={id}
        className={cn(
          "pointer-events-none absolute left-3 bg-pa-bg px-1.5 transition-all",
          raised
            ? cn(
                "top-0 -translate-y-1/2 text-xs",
                focused ? "text-pa-highlight" : "text-pa-login-label",
              )
            : "top-1/2 -translate-y-1/2 text-base text-pa-login-label",
        )}
      >
        {label} *
      </label>
    </div>
  );
}

function LoginGate({ onPassword, signedIn }: { onPassword: () => void; signedIn: boolean }) {
  return (
    <div className="flex w-full max-w-sm flex-col items-center">
      <h1 className="mb-8 text-center font-serif text-[1.75rem] leading-[1.875rem] font-normal text-pa-fg md:text-[2.25rem] md:leading-10">
        登录或创建账号
      </h1>
      {signedIn ? (
        <p className="text-center text-sm text-pa-muted">
          已登录。窗口未自动跳转时，请回到客户端重新发起连接。
        </p>
      ) : (
        <Button type="button" variant="default" size="lg" onClick={onPassword}>
          使用密码登录
        </Button>
      )}
      <p className="mt-16 text-sm font-medium text-pa-fg">PA</p>
    </div>
  );
}

function LoginPasswordCard({
  email,
  password,
  error,
  pending,
  signedIn,
  showPassword,
  emailRef,
  onEmail,
  onPassword,
  onTogglePassword,
  onSubmit,
  onBack,
}: {
  email: string;
  password: string;
  error: string | null;
  pending: boolean;
  signedIn: boolean;
  showPassword: boolean;
  emailRef: RefObject<HTMLInputElement | null>;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onTogglePassword: () => void;
  onSubmit: (e: FormEvent) => void;
  onBack: () => void;
}) {
  return (
    <div className="w-full max-w-[400px] rounded-xl bg-pa-bg p-10 shadow-login">
      <Avatar className="mb-6" size="lg" tone="ink" aria-hidden>
        PA
      </Avatar>
      <h1 className="mb-4 text-[1.5rem] leading-9 font-normal text-pa-fg">欢迎</h1>
      <p className="mb-6 text-sm leading-5 text-pa-fg">登录 PA 数据服务以继续。</p>

      {signedIn ? (
        <p className="text-sm text-pa-muted">
          已登录。窗口未自动跳转时，请回到客户端重新发起连接。
        </p>
      ) : (
        <Form className="flex w-full flex-col gap-4" onSubmit={onSubmit}>
          <LoginFloatingField
            label="邮箱"
            type="email"
            autoComplete="username"
            required
            inputRef={emailRef}
            value={email}
            onChange={onEmail}
          />
          <LoginFloatingField
            label="密码"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={onPassword}
            trailing={
              <button
                type="button"
                className="flex size-13 shrink-0 items-center justify-center text-pa-login-label hover:text-pa-fg"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                onClick={onTogglePassword}
              >
                {showPassword ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
              </button>
            }
          />
          {error ? <p className="text-xs text-pa-danger-fg">{error}</p> : null}
          <Button
            variant="filled"
            type="submit"
            loading={pending}
            className="mt-2 h-13 w-full rounded-auth text-base font-normal"
          >
            继续
          </Button>
        </Form>
      )}

      <button
        type="button"
        className="mt-6 text-sm text-pa-muted underline-offset-2 hover:text-pa-fg hover:underline"
        onClick={onBack}
      >
        返回
      </button>
    </div>
  );
}

export function LoginPage() {
  const [view, setView] = useState<LoginView>(readView);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onPop = () => setView(readView());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (view === "password" && !signedIn) emailRef.current?.focus();
  }, [view, signedIn]);

  function goPassword() {
    writeView("password");
    setView("password");
    setError(null);
  }

  function goGate() {
    writeView("gate");
    setView("gate");
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { data, error: err } = await authClient.signIn.email({ email, password });
    if (err) {
      setError(err.message ?? "登录失败，请检查账号与密码。");
      setPending(false);
      return;
    }
    // 有未完成的授权流程时，插件马上会整页跳转，这里保持 pending 状态
    if (!data?.url) {
      const target = safeRedirect();
      if (target) {
        window.location.assign(target);
        return;
      }
      setSignedIn(true);
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center bg-pa-canvas px-6 py-10">
      {view === "gate" ? (
        <LoginGate onPassword={goPassword} signedIn={signedIn} />
      ) : (
        <LoginPasswordCard
          email={email}
          password={password}
          error={error}
          pending={pending}
          signedIn={signedIn}
          showPassword={showPassword}
          emailRef={emailRef}
          onEmail={setEmail}
          onPassword={setPassword}
          onTogglePassword={() => setShowPassword((v) => !v)}
          onSubmit={onSubmit}
          onBack={goGate}
        />
      )}
    </div>
  );
}
