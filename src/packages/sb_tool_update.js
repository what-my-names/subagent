/*
 * 自更新与外部跳转工具集（从 subagent.js 拆出）
 *
 * 用途：subagent_check_update / download_update / download_status / install_update /
 *       open_mail / open_url 六个工具的实现。
 * 为什么单独成文件：这组工具只依赖 sb_update.js，与任务/群组/流式链路无关，
 *       拆出来可以单独改更新逻辑，不用在三千行文件里定位。
 * 入参：install(E, opts)
 *   E    —— subagent.js 的 exports 对象，工具直接挂上去
 *   opts.version  —— 包版本号
 *   opts.complete —— 宿主注入的 complete 回调；必须显式传入，
 *                    子模块拿不到全局，不传会 ReferenceError
 * 出参：无，直接往 E 上挂六个工具。
 */
var UPDPKG = require("./sb_update.js");

module.exports = function install(E, opts) {
    var VERSION = (opts && opts.version) || "";
    var UPD = UPDPKG;
    var complete = opts && opts.complete;
    if (typeof complete !== "function") throw new Error("installToolUpdate: 缺 complete");


    E.subagent_check_update = async function (params) {
        params = params || {};
        var r = await UPD.checkUpdate({ force: !!params.force });
        if (!r.ok) {
            complete({ success: false, message: r.msg, data: { error: r.msg } });
            return;
        }
        complete({ success: true, message: r.msg, data: r.data });
    };

    E.subagent_download_update = async function (params) {
        params = params || {};
        var r = await UPD.downloadUpdate({ force: !!params.force });
        complete({ success: !!r.ok, message: r.msg, data: r.data || {} });
    };

    E.subagent_download_status = async function () {
        var r = await UPD.downloadStatus();
        complete({ success: true, message: r.msg, data: r.data });
    };

    E.subagent_install_update = async function (params) {
        params = params || {};
        var r = await UPD.installUpdate({ path: params.path });
        complete({ success: !!r.ok, message: r.msg, data: r.data || {} });
    };
    /* 反馈邮箱：WebView 不能直接跳 mailto:，走后端发 SENDTO intent */
    E.subagent_open_mail = async function (params) {
        params = params || {};
        var r = await UPD.openMail({ email: params.email, subject: params.subject, kind: params.kind, version: VERSION });
        complete({ success: !!r.ok, message: r.msg, data: r.data || {} });
    };
    /* 外链：同样不能 location.href，走后端 VIEW intent */
    E.subagent_open_url = async function (params) {
        params = params || {};
        var r = await UPD.openUrl({ url: params.url });
    complete({ success: !!r.ok, message: r.msg, data: r.data || {} });
    };
};
