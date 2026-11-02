#!/usr/bin/env python3
"""读取校验脚本产出的证据 JSON，按 status 判定该步是否真的通过。

为什么需要这个（2026-11-02）：
校验脚本为了「不牵连已成功的构建」，失败时也 exit 0，把真实结果写进 JSON。
于是一个编译失败 / 证据缺失 / 环境不具备的步骤，在 Actions 页面上照样是绿色。
光看 step 结论会被误导，必须读 JSON 的 status。

用法：
  python3 check-evidence-status.py <证据文件> <通过值> [说明文字]

退出码：
  0  status == 通过值
  1  status != 通过值（含文件缺失、JSON 非法）—— CI 会把它标红

行为：
  * 通过 → 打印一行 `::notice::`，不阻断。
  * 不通过 → 打印 `::error::` 并把证据原文摘要贴出来，CI 步骤变红。
  * 文件不存在 → 明确报「证据文件缺失」，与「status=ERROR」「status=NOT_RUN」区分开。
"""
import json
import os
import sys


def fail(msg):
    print("::error::%s" % msg)
    sys.exit(1)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    path = sys.argv[1]
    want = sys.argv[2]
    label = sys.argv[3] if len(sys.argv) > 3 else os.path.basename(path)

    if not os.path.exists(path):
        fail(
            "%s：证据文件不存在（%s）。\n"
            "这是最需要警惕的状态 —— 无法区分「校验脚本崩溃」与「本次未执行」。\n"
            "请检查该步骤日志；若脚本自身异常，脚本应已写出 status=ERROR 的记录。" % (label, path)
        )
        return

    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except Exception as e:
        fail("%s：证据文件不是合法 JSON（%s）：%s" % (label, path, e))
        return

    status = d.get("status")
    if status is None:
        fail("%s：证据 JSON 里没有 status 字段（%s）" % (label, path))
        return

    if status == want:
        print("::notice::%s：status=%s，符合预期" % (label, status))
        return

    # 不通过：把原因字段一起贴出来，便于在 Actions 页面直接看清原因
    detail = d.get("error") or d.get("reason") or ""
    print("::error::%s：status=%s，期望 %s" % (label, status, want))
    if detail:
        print("::error::  原因：%s" % detail)
    for k in ("diagnostics", "hap"):
        if k in d:
            print("::error::  %s：%s" % (k, json.dumps(d[k], ensure_ascii=False)))
    if status == "ERROR":
        print("::error::  status=ERROR 表示校验脚本自身崩溃或被中断，不等于环境不具备。")
    elif status == "NOT_RUN":
        print("::error::  status=NOT_RUN 表示环境不具备、本次未执行。")
    sys.exit(1)


if __name__ == "__main__":
    main()
