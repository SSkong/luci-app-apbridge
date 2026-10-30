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

# rpcd-mod-ucode 提供 /usr/share/rpcd/ucode 的执行环境；firewall4 是写 zone 的前提；
# ip-tiny 提供 /sbin/ip（busybox 不带 ip applet）。不用 +ip-full 是为了避免与
# 已经装了 ip-full 的镜像产生包冲突——两者 PROVIDES 同一个 ip。
LUCI_DEPENDS:=+rpcd +rpcd-mod-ucode +firewall4 +ip-tiny

define Package/luci-app-apbridge/conffiles
/etc/config/apbridge
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
