# luci-app-apbridge

让 LAN 客户端访问**位于其它子网**的 AP（LAN 侧）或光猫（WAN 侧）。适配 OpenWrt 25.12，全 JS 前端 + rpcd ucode 后端。

## 它解决的问题

典型两种场景，客户端都不知道该怎么走：

| 场景 | 现象 | 原因 |
|---|---|---|
| AP 接在 LAN 口，但它是 192.168.31.1，你的 LAN 是 192.168.1.0/24 | 浏览器打不开 192.168.31.1 | 客户端把包丢给网关，路由器没有 192.168.31.0/24 的接口，也没有回程路由 |
| 光猫桥接，路由器 PPPoE 拨号，光猫管理地址 192.168.1.1 | 同样打不开 | WAN 口没有三层地址，PPPoE 会话之上没有 192.168.1.0/24 |

本插件在目标设备所在的子网里**占用一个空闲地址**（例如 192.168.31.254），把它挂到路由器上，再经 wan 防火墙区域做源地址转换。目标设备看到的流量源地址是它自己网段内的地址，因此**不需要它有任何回程路由**。

## 为什么不能只加个 IP

直接在 `br-lan` 上加 192.168.31.254 也能让路由器自己 ping 通 AP，但客户端访问会失败：那样目标网段成了 LAN 的一部分，走同区域转发、**不做 NAT**，而 AP 不知道 192.168.1.0/24 在哪，回包会被它丢给默认网关。

所以 LAN 侧必须让这段地址脱离 LAN 的三层接口：

```
客户端 192.168.1.100
   │  默认路由
   ▼
路由器 br-lan ──(L2)── veth: apb1 ──┐
                                    │ 独立接口 apb1p：192.168.31.254/24
                                    ▼
                          防火墙 wan 区域 → masquerade
                                    │
                                    ▼
                            AP 192.168.31.1（看到源是 192.168.31.254）
```

WAN 侧不需要 veth：PPPoE 时物理 WAN 设备上没有三层地址，直接给它配一个静态地址即可，同样丢进 wan 区域做 masquerade。

## 功能范围

- **多条通道**：每个目标设备一条，用表格增删，不再固定只能填「LAN」和「WAN」两个框
- **子网冲突检测**：与回环、LAN 网段、其它通道逐一比对；冲突或格式错误的地址**跳过并写日志**，不会把本地管理地址拽进别的网段
- **`/32` 与广播地址拦截**：`/32` 形不成子网，广播地址不可用
- **运行状态面板**：通道接口是否被 netifd 创建、是否 up、实际下发的地址、目标连通性
- **连通性测试**：ping + HTTP（curl 优先，退 wget），结果显示状态码
- **一键跳转**：填了目标地址就能直接开新标签打开管理页
- **干净卸载**：关掉开关或卸载时，本插件写入的接口、veth、桥端口、防火墙区域引用全部按前缀清除
- **中英双语**

## 与上游 `zyqfork/luci-app-ap-modem` 的差异

上游思路是对的（同样用 veth + wan 区域做 NAT），实现上有几处会咬人的地方，本插件做了修正：

| 上游 | 本插件 |
|---|---|
| 写死要求 `network.lan.device == br-lan`，否则直接报错退出 | 按 `network.lan.device` 自动找 LAN 桥的 device 段；不是桥时在界面上明确提示原因，而不是只写 stderr |
| 只支持 LAN/WAN 两个固定配置段 | `channel` 为可变列表，可加多条 |
| 地址冲突只在运行时 `log warn`，界面上看不到 | 冲突检测保留在脚本里（最终防线），同时状态面板会显示「未创建」，界面能立刻看出来 |
| 用 `[[ ]]` 写在 `#!/bin/sh` 脚本里 | 全部改为 POSIX `[ ]`，busybox ash 下不会因 bashism 失败 |
| 没有运行态反馈 | 状态面板 + 连通性测试 + 一键跳转 |
| 只处理 `/32` 跳过 | 额外拦广播地址，纯 IP 显式归一成 `/24` 再下发 |

## 依赖

```
luci-base          (luci.mk 自动带入)
rpcd               ubus 对象宿主
rpcd-mod-ucode     提供 /usr/share/rpcd/ucode 的执行环境
firewall4          写 wan 区域的 network 列表、提供 masquerade
```

刻意**不依赖 `ip-tiny` / `ip-full`**：插件只用 `ipcalc.sh`、`uci`、`ubus`，不需要 `ip` 命令。而 `ip-tiny` 与 `ip-full` 是同一源包的两个变体、互相冲突，硬依赖任何一个都会让已经装了另一个变体的镜像在装包阶段报冲突——这类冲突在构建期表现为 image 组装失败，排查起来很绕。

运行期还用到 `ipcalc.sh`（base-files 自带）、`ubus`（netifd 自带）、`ping`（iputils-ping，仅连通性测试用，缺失时只是测试不可用）。**不依赖 curl/wget**：有就用 curl，没有退 wget，都没有就只显示 ping 结果。

## 目录结构

```
luci-app-apbridge/
├── Makefile                                    # 走 feeds/luci/luci.mk，LUCI_PKGARCH=all
├── README.md
├── htdocs/
│   └── luci-static/resources/view/apbridge.js  # 前端：GridSection + 状态面板 + poll
├── po/
│   └── zh_Hans/apbridge.po                     # 中文翻译（47 条）
└── root/
    ├── etc/config/apbridge                     # 默认配置（两条示例通道）
    ├── etc/init.d/apbridge                     # 核心：uci 手术 + reload network
    └── usr/share/
        ├── luci/menu.d/luci-app-apbridge.json  # 菜单：网络 → AP / 光猫访问
        ├── rpcd/acl.d/luci-app-apbridge.json   # ACL：status/probe 只读，apply 需写权限
        └── rpcd/ucode/luci.apbridge            # 后端：status / probe / apply
```

## 配置项

`/etc/config/apbridge`：

```uci
config settings 'settings'
	option enabled '0'          # 总开关；关闭时会清理本插件创建的所有对象

config channel 'ap'
	option name 'AP'            # 显示名
	option side 'lan'           # lan = 目标在 LAN 侧；wan = 目标在 WAN 侧
	option enabled '1'          # 单通道开关，便于临时停用而不删配置
	option target '192.168.31.1'      # 可选，填了才能做连通性测试和跳转
	list addr '192.168.31.254/24'     # 虚拟地址，可多条
```

`addr` 支持 `IP/prefix`、`IP/NETMASK`、纯 `IP`（按 `/24` 处理）。

## 使用步骤

1. 打开 **网络 → AP / 光猫访问**
2. 勾选「启用」
3. 在「访问通道」里新增一行：
   - 名称：随意
   - 位置：AP 接在 LAN 口选 `LAN 侧`；光猫在 WAN 侧选 `WAN 侧`
   - 目标地址：设备的管理地址，例 `192.168.31.1`
   - 虚拟地址：目标子网里的**空闲**地址，例 `192.168.31.254/24`
4. 保存并应用（`uci apply` 会通过 procd reload 触发器自动重新下发）
5. 看下方「运行状态」：接口应为 `已启用`，生效地址应包含你填的地址
6. 点「测试」确认 ping / HTTP 通，或直接点目标地址跳转

停用：取消「启用」再保存并应用，插件会删掉 veth、接口、桥端口与防火墙引用，网络回到原样。

## 命令行等价操作

```sh
uci set apbridge.settings.enabled='1'
uci set apbridge.ap=channel
uci set apbridge.ap.name='AP'
uci set apbridge.ap.side='lan'
uci set apbridge.ap.target='192.168.31.1'
uci add_list apbridge.ap.addr='192.168.31.254/24'
uci commit apbridge
/etc/init.d/apbridge reload
```

排查时看日志（冲突、跳过原因都写在这里）：

```sh
logread -e apbridge
```

确认内核侧状态：

```sh
ubus call network.interface dump | grep -A3 apb1
ubus call network.device status '{"name":"apb1p"}'
nft list ruleset | grep -A3 'chain srcnat_wan'
```

装了 `ip-full` 的话也可以 `ip -br addr show apb1p` 看地址是否真的落到设备上。

## 已知边界

- **LAN 侧需要桥**：veth 的一端要桥进 LAN 设备，所以 LAN 必须是桥（OpenWrt 默认 `br-lan` 就是）。不是桥时界面会提示，通道不会创建。
- **虚拟地址会占着不放**：它是路由器上的真实地址，别选目标设备正在用的 IP，否则冲突。
- **通道顺序决定接口名**：接口名按通道在配置里的顺序生成（`apb1`、`apb2`…），增删中间的行会让后面的接口改名并重建，属预期行为。
- **不做 hairpin**：内网客户端通过公网地址访问内网服务不在本插件范围内。
- 只处理 IPv4。
