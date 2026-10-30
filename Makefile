#
# Copyright (C) 2026 SSkong
#
# This is free software, licensed under the Apache License, Version 2.0.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-apbridge
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=SSkong

LUCI_TITLE:=Access AP / modem that live on a different subnet
LUCI_DESCRIPTION:=Publish a spare address inside the target device subnet and NAT through the wan firewall zone, so LAN clients can open an AP on the LAN side or a PPPoE-bridged modem on the WAN side without touching client routes.
LUCI_PKGARCH:=all

# rpcd-mod-ucode 提供 /usr/share/rpcd/ucode 的执行环境；firewall4 是写 zone 的前提。
# 刻意不依赖 ip-tiny / ip-full：本插件只用 ipcalc.sh、uci、ubus，不需要 ip 命令；
# 而 ip-tiny 与 ip-full 是同一源包的两个变体、互相冲突，硬依赖任何一个都会让
# 已经装了另一个变体的镜像在装包阶段报冲突。
LUCI_DEPENDS:=+rpcd +rpcd-mod-ucode +firewall4

define Package/luci-app-apbridge/conffiles
/etc/config/apbridge
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
