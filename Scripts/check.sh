#!/bin/sh
# luci-app-apbridge 静态自检 —— 在提交前跑一遍，能挡住两类「构建能过、装上却废」
# 的问题。不需要 OpenWrt 环境，只需 sh + git + （可选）ucode。
#
#   ./Scripts/check.sh
#
# 退出码：0 全通过；1 有错误。

set -u

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR" || exit 1

err=0
warn=0

say_err() { printf '\033[31m[ERROR]\033[0m %s\n' "$*"; err=$((err + 1)); }
say_warn() { printf '\033[33m[WARN ]\033[0m %s\n' "$*"; warn=$((warn + 1)); }
say_ok() { printf '\033[32m[ OK  ]\033[0m %s\n' "$*"; }

# ── 1. init.d 脚本必须可执行 ────────────────────────────────────────────────
# luci.mk 用 Build/Install/Default + $(CP) 安装，全程保留源文件权限，
# 所以 git 里记成 100644 就必然装成 644。表现是 /etc/init.d/apbridge 报
# Permission denied，配置永远不下发，界面上点「启用」毫无反应。
# Windows 上 chmod 不生效（core.filemode=false），只能用 git update-index 改。
for f in $(git ls-files 'root/etc/init.d/*' 2>/dev/null); do
	mode="$(git ls-files -s "$f" | awk '{print $1}')"
	if [ "$mode" = "100755" ]; then
		say_ok "可执行位 $f"
	else
		say_err "$f 在 git 里是 $mode，应为 100755（执行：git update-index --chmod=+x $f）"
	fi
done

# ── 2. .uc 文件禁止 ucode 不支持的语法 ─────────────────────────────────────
# ucode 不是 JS：for (const x in ...) / for (x of ...) / throw 全部是编译期
# Syntax error，而 rpcd 加载失败时完全静默 —— 文件在、ubus 对象不存在，
# 前端只会说「请确认 rpcd 正在运行」。
for f in $(git ls-files '*.uc' '*.ucode' 2>/dev/null) \
         $(git ls-files 'root/usr/share/rpcd/ucode/*' 2>/dev/null); do
	[ -f "$f" ] || continue

	if grep -nE '^[^/]*for[[:space:]]*\([[:space:]]*const[[:space:]]' "$f" >/dev/null 2>&1; then
		say_err "$f 使用了 ucode 不支持的 for (const ...)："
		grep -nE '^[^/]*for[[:space:]]*\([[:space:]]*const[[:space:]]' "$f" | sed 's/^/         /'
		say_warn "  改用 for (let i = 0; i < length(a); i++) 或 for (v in a)（后者拿到的是元素本身）"
	fi

	if grep -nE '^[^/]*for[[:space:]]*\([^)]*[[:space:]]of[[:space:]]' "$f" >/dev/null 2>&1; then
		say_err "$f 使用了 ucode 不支持的 for ... of"
		grep -nE '^[^/]*for[[:space:]]*\([^)]*[[:space:]]of[[:space:]]' "$f" | sed 's/^/         /'
	fi

	if grep -nE '^[^/]*[^A-Za-z0-9_.]throw[[:space:]]' "$f" >/dev/null 2>&1; then
		say_err "$f 使用了 ucode 不支持的 throw（用 die() 代替）"
		grep -nE '^[^/]*[^A-Za-z0-9_.]throw[[:space:]]' "$f" | sed 's/^/         /'
	fi

	say_ok "语法约定 $f"

	# 有 ucode 就用真正的编译器复核（最可靠）
	if command -v ucode >/dev/null 2>&1; then
		if ucode -c "$f" 2>/tmp/apb-ucode.err; then
			say_ok "ucode -c $f"
		else
			say_err "ucode 编译失败 $f"
			sed 's/^/         /' /tmp/apb-ucode.err
			rm -f /tmp/apb-ucode.err
		fi
	fi
done

# ── 3. shell 脚本语法 ──────────────────────────────────────────────────────
for f in $(git ls-files 'root/etc/init.d/*' 'root/etc/uci-defaults/*' 'root/usr/libexec/*' 'Scripts/*.sh' 2>/dev/null); do
	[ -f "$f" ] || continue
	if sh -n "$f" 2>/tmp/apb-sh.err; then
		say_ok "sh -n $f"
	else
		say_err "shell 语法错误 $f"
		sed 's/^/         /' /tmp/apb-sh.err
	fi
	rm -f /tmp/apb-sh.err
done

# ── 4. 前端 JS 语法 ────────────────────────────────────────────────────────
if command -v node >/dev/null 2>&1; then
	for f in $(git ls-files 'htdocs/*.js' 2>/dev/null); do
		[ -f "$f" ] || continue
		if node --check "$f" 2>/tmp/apb-js.err; then
			say_ok "node --check $f"
		else
			say_err "JS 语法错误 $f"
			sed 's/^/         /' /tmp/apb-js.err
		fi
		rm -f /tmp/apb-js.err
	done
else
	say_warn "没装 node，跳过前端 JS 语法检查"
fi

# ── 5. 换行符：CRLF 会让 shebang 失效、ucode 编译失败 ──────────────────────
for f in $(git ls-files 'root/etc/*' 'root/usr/*' '*.uc' '*.js' 2>/dev/null); do
	[ -f "$f" ] || continue
	if grep -q "$(printf '\r')" "$f" 2>/dev/null; then
		say_err "$f 含 CRLF，必须转成 LF"
	fi
done

echo
if [ "$err" -gt 0 ]; then
	printf '\033[31m%d 项错误\033[0m' "$err"
	[ "$warn" -gt 0 ] && printf '，%d 项警告' "$warn"
	echo
	exit 1
fi

printf '\033[32m全部通过\033[0m'
[ "$warn" -gt 0 ] && printf '（%d 项警告）' "$warn"
echo
exit 0
