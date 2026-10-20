/**
 * 模型名拼写自愈的回归测试（2026-10-20）。
 *
 * 事故现场：用户在配置界面手打模型名，把 `MiniMax-M3.1-Flash` 写成
 * `MiniMax-M3.1-Flah`（少个 s）。服务端不认这个名字，每次请求直接
 * `400 unknown model` —— 而用户是**点了八分钟之后**才看到这个错误。
 *
 * 这条测试锁住两件事：
 *  1. 明显的手误要能自动纠正（少个字母这种）；
 *  2. 私有模型名必须**原样发出** —— tokenplan 的模型名不在公开清单里，
 *     瞎猜等于把一个可用配置改成一个不可用的。
 */
import { describe, it, expect } from 'vitest';
import { correctModelName } from './minimax.js';

describe('correctModelName —— 模型名拼写自愈', () => {
  it('事故现场：Flah → Flash', () => {
    expect(correctModelName('MiniMax-M3.1-Flah')).toEqual({
      model: 'MiniMax-M3.1-Flash',
      corrected: true,
    });
  });

  it('大小写变体也能纠（手打常带大小写错）', () => {
    expect(correctModelName('minimax-m3.1-flah')).toEqual({
      model: 'MiniMax-M3.1-Flash',
      corrected: true,
    });
  });

  it('拼对了就不动（不能无脑改写用户配置）', () => {
    expect(correctModelName('MiniMax-M3.1-Flash')).toEqual({
      model: 'MiniMax-M3.1-Flash',
      corrected: false,
    });
    expect(correctModelName('MiniMax-M3')).toEqual({
      model: 'MiniMax-M3',
      corrected: false,
    });
  });

  it('私有模型名原样发出（不瞎猜）', () => {
    // tokenplan 的模型名不在公开清单里 —— 距离够近也不能改
    const r = correctModelName('my-private-model-v2');
    expect(r.corrected).toBe(false);
    expect(r.model).toBe('my-private-model-v2');
  });

  it('空名原样返回（真正的空值由调用方报错，不在这里处理）', () => {
    expect(correctModelName('')).toEqual({ model: '', corrected: false });
  });

  it('离所有已知名都很远的字符串不改', () => {
    const r = correctModelName('totally-unrelated-identifier');
    expect(r.corrected).toBe(false);
    expect(r.model).toBe('totally-unrelated-identifier');
  });
});
