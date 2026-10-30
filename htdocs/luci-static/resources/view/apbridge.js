'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';
'require poll';

/*
 * luci-app-apbridge 前端
 *
 * 配置面用 form.GridSection（25.12 内置），一个表格就能增删多条访问通道；
 * 运行态单独成块，由 poll 每 5 秒拉一次 luci.apbridge status。
 * 所有会改动网络的逻辑都在后端（init.d + rpcd ucode），这里只做展示与触发。
 */

var callStatus = rpc.declare({
	object: 'luci.apbridge',
	method: 'status'
});

var callProbe = rpc.declare({
	object: 'luci.apbridge',
	method: 'probe',
	params: [ 'host' ]
});

var callApply = rpc.declare({
	object: 'luci.apbridge',
	method: 'apply'
});

function dot(color, text) {
	return E('span', {}, [
		E('span', { style: 'color:%s'.format(color) }, '\u25CF'),
		' ',
		text
	]);
}

function ok(text)   { return dot('#2e7d32', text); }
function warn(text) { return dot('#ef6c00', text); }
function bad(text)  { return dot('#c62828', text); }
function idle(text) { return dot('#9e9e9e', text); }

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('apbridge'),
			L.resolveDefault(callStatus(), null)
		]);
	},

	render: function(data) {
		var m, s, o;
		var status = data[1];

		m = new form.Map('apbridge', _('AP / Modem Access'),
			_('Reach an AP on the LAN side, or a modem on the WAN side, that lives in another subnet. The router publishes a spare address inside the target subnet and NATs through the wan firewall zone, so the target device sees traffic from its own subnet and needs no return route.'));

		s = m.section(form.NamedSection, 'settings', 'settings', _('General'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('Enable'),
			_('When disabled, every object this app created is removed and the network configuration is restored.'));
		o.rmempty = false;
		o.default = '0';

		s = m.section(form.GridSection, 'channel', _('Access channels'),
			_('One channel per target device. Addresses must be free, belong to the same subnet as the target, and must not overlap the LAN or any other channel.'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;

		o = s.option(form.Value, 'name', _('Name'));
		o.rmempty = false;
		o.placeholder = 'AP';

		o = s.option(form.ListValue, 'side', _('Location'));
		o.value('lan', _('LAN side — AP behind a LAN port'));
		o.value('wan', _('WAN side — modem behind the WAN port'));
		o.default = 'lan';
		o.rmempty = false;

		o = s.option(form.Value, 'target', _('Target address'),
			_('Optional. Management address of the device. Used for the connectivity test and the shortcut link.'));
		o.datatype = 'ip4addr';
		o.placeholder = '192.168.31.1';

		o = s.option(form.DynamicList, 'addr', _('Virtual address'),
			_('One free address inside the target subnet, e.g. 192.168.31.254/24. A bare IP is treated as /24.'));
		o.datatype = 'ipmask4';
		o.placeholder = '192.168.31.254/24';

		o = s.option(form.Flag, 'enabled', _('Active'));
		o.default = '1';
		o.rmempty = false;

		return m.render().then(L.bind(function(node) {
			var panel = E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Runtime status')),
				this.renderStatus(status)
			]);

			poll.add(L.bind(this.pollStatus, this), 5);

			return E('div', {}, [ node, panel ]);
		}, this));
	},

	pollStatus: function() {
		return L.resolveDefault(callStatus(), null).then(L.bind(function(status) {
			var el = document.getElementById('apbridge-status');
			if (!el || !status)
				return;

			var fresh = this.renderStatus(status);
			el.innerHTML = '';
			while (fresh.firstChild != null)
				el.appendChild(fresh.firstChild);
		}, this));
	},

	renderStatus: function(status) {
		var self = this;

		if (!status)
			return E('div', { 'id': 'apbridge-status' },
				E('em', {}, _('Unable to query runtime status. Check that rpcd is running.')));

		var rows = [];
		var notices = [];

		if (!status.enabled)
			notices.push(E('div', { 'class': 'alert-message warning' },
				_('The feature is disabled. Enable it above and apply to create the channels.')));

		if (!status.lan_is_bridge && (status.channels || []).some(function(c) { return c.side == 'lan'; }))
			notices.push(E('div', { 'class': 'alert-message warning' },
				_('LAN device "%s" is not a bridge. LAN-side channels need a bridge (usually br-lan) to attach the veth pair to.')
					.format(status.lan_device || '?')));

		if (!status.wan_device && (status.channels || []).some(function(c) { return c.side == 'wan'; }))
			notices.push(E('div', { 'class': 'alert-message warning' },
				_('No WAN device could be detected. WAN-side channels cannot be created.')));

		(status.channels || []).forEach(function(ch) {
			var state;

			if (!ch.enabled)
				state = idle(_('Paused'));
			else if (ch.present && ch.up)
				state = ok(_('Up'));
			else if (ch.present)
				state = warn(_('Present, not up'));
			else
				state = bad(_('Not created'));

			var active = ch.active.length
				? ch.active.join(', ')
				: E('em', {}, _('none'));

			var target;
			if (ch.target) {
				target = E('span', {}, [
					E('a', {
						href: 'http://%s'.format(ch.target),
						target: '_blank',
						rel: 'noreferrer noopener'
					}, ch.target),
					' ',
					E('button', {
						'class': 'cbi-button cbi-button-action',
						click: function(ev) {
							ev.preventDefault();
							self.doProbe(ch);
						}
					}, _('Test'))
				]);
			}
			else {
				target = E('em', {}, _('not set'));
			}

			rows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ E('strong', {}, ch.name), ' ',
					E('span', { 'class': 'ifacebadge' }, ch.ifname) ]),
				E('td', { 'class': 'td' }, ch.side == 'wan' ? _('WAN side') : _('LAN side')),
				E('td', { 'class': 'td' }, state),
				E('td', { 'class': 'td' }, active),
				E('td', { 'class': 'td' }, target),
				E('td', { 'class': 'td', 'id': 'apbridge-probe-%d'.format(ch.index) }, '')
			]));
		});

		var table;

		if (rows.length) {
			table = E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, _('Channel')),
					E('th', { 'class': 'th' }, _('Location')),
					E('th', { 'class': 'th' }, _('Interface')),
					E('th', { 'class': 'th' }, _('Active addresses')),
					E('th', { 'class': 'th' }, _('Target')),
					E('th', { 'class': 'th' }, _('Connectivity'))
				])
			].concat(rows));
		}
		else {
			table = E('em', {}, _('No channels configured yet.'));
		}

		var applyBtn = E('button', {
			'class': 'cbi-button cbi-button-apply',
			click: function(ev) {
				ev.preventDefault();
				self.doApply(ev.currentTarget);
			}
		}, _('Re-apply configuration'));

		return E('div', { 'id': 'apbridge-status' }, [
			E('div', {}, notices),
			table,
			E('div', { style: 'margin-top:1em' }, applyBtn)
		]);
	},

	doProbe: function(ch) {
		var cell = document.getElementById('apbridge-probe-%d'.format(ch.index));
		if (cell)
			cell.innerHTML = '';
		if (cell)
			cell.appendChild(E('em', {}, _('testing…')));

		return L.resolveDefault(callProbe(ch.target), { ok: false, error: 'rpc failed' })
			.then(function(res) {
				if (!cell)
					return;

				var out = [];

				if (!res || res.ok === false) {
					out.push(bad((res && res.error) ? res.error : _('probe failed')));
				}
				else {
					out.push(res.ping ? ok(_('ping ok')) : bad(_('no ping')));
					out.push(' ');

					if (res.http === true)
						out.push(ok(res.http_code ? _('HTTP %d').format(res.http_code) : _('HTTP ok')));
					else if (res.http === false)
						out.push(warn(_('no HTTP')));
					else
						out.push(idle(_('HTTP not tested')));
				}

				cell.innerHTML = '';
				out.forEach(function(n) { cell.appendChild(n); });
			});
	},

	doApply: function(btn) {
		btn.disabled = true;

		return L.resolveDefault(callApply(), { ok: false, output: 'rpc failed' })
			.then(function(res) {
				btn.disabled = false;

				if (res && res.ok) {
					ui.addNotification(null, E('p', {}, _('Configuration applied.')), 'info');
				}
				else {
					ui.addNotification(null, E('p', {},
						_('Apply failed: %s').format((res && res.output) || '?')), 'danger');
				}

				return this.pollStatus();
			}.bind(this))
			.catch(function(err) {
				btn.disabled = false;
				ui.addNotification(null, E('p', {}, _('Apply failed: %s').format(err)), 'danger');
			});
	}
});
