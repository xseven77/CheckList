'use client';

import { useEffect, useRef, useState } from 'react';
import { type Checklist as Doc } from '@/lib/types';
import { MicIcon, SparklesIcon } from './Icons';

type VoiceModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onApplyAI: (text: string) => Promise<{ doc: Doc; summary: string }>;
  showToast: (text: string, type?: 'success' | 'info' | 'warn' | 'err', undo?: () => void, duration?: number) => void;
};

const PRESET_EXAMPLES = [
  '8号下午加一个答谢宴，准备伴手礼30份、提前订包厢、结清酒水',
  '在3号增加明细：通知伴郎伴娘提早半小时到',
  '把开场视频标记为已完成',
  '6号下午加一个婚礼彩排，带上捧花和誓词卡',
];

export default function VoiceModal({ isOpen, onClose, onApplyAI, showToast }: VoiceModalProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 快捷关闭 (ESC)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, submitting, onClose]);

  // 打开弹窗自动聚焦输入框，方便手机直接弹起键盘使用输入法语音
  useEffect(() => {
    if (isOpen) {
      setErr('');
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const prompt = text.trim();
    if (!prompt) {
      setErr('请先输入或使用输入法语音录入内容');
      textareaRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setErr('');
    showToast('AI 正在理解并转换项目数据结构…', 'info', undefined, 2000);

    try {
      const res = await onApplyAI(prompt);
      showToast(res.summary || 'AI 智能解析成功，已体现到清单！', 'success', undefined, 4000);
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'AI 解析失败，请重试';
      setErr(msg);
      showToast('AI 解析失败，请重试', 'err');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="AI 智能口述助手">
      <div className="voice-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="voice-modal-header">
          <h2>
            <SparklesIcon size={22} className="voice-header-icon" />
            AI 智能口述助手
          </h2>
          <button type="button" className="btn sm quiet" onClick={onClose} disabled={submitting}>
            关闭
          </button>
        </div>

        {/* 引导卡片：提示使用输入法自带语音识别 */}
        <div className="voice-guide-card">
          <div className="voice-guide-header">
            <MicIcon size={18} />
            <span>推荐使用手机键盘自带语音识别</span>
          </div>
          <p className="voice-guide-desc">
            点击下方输入框唤起键盘，直接点击键盘上的<strong>麦克风 / 语音按键</strong>（如微信键盘、苹果键盘自带听写、搜狗输入法语音）直接口述，说话自动转文字，识别率极高！
          </p>
        </div>

        {/* 输入框区 */}
        <div className="voice-textarea-wrap">
          <div className="voice-textarea-header">
            <label htmlFor="voice-result-input">口述或输入的内容：</label>
            {text && (
              <button
                type="button"
                className="voice-clear-btn"
                onClick={() => {
                  setText('');
                  textareaRef.current?.focus();
                }}
              >
                清空
              </button>
            )}
          </div>
          <textarea
            ref={textareaRef}
            id="voice-result-input"
            className="voice-textarea"
            rows={4}
            placeholder="点击此处唤起键盘，用输入法语音键直接说话…&#10;例如：“8号下午加一个答谢宴，包含准备伴手礼30份、提前订包厢、结清酒水”"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={submitting}
          />
        </div>

        {/* 快捷示例 */}
        <div className="voice-chips-label">也可以点击填入常见口述示例体验：</div>
        <div className="voice-chips">
          {PRESET_EXAMPLES.map((ex, i) => (
            <button
              key={i}
              type="button"
              className="voice-chip"
              onClick={() => {
                setText(ex);
                setErr('');
                textareaRef.current?.focus();
              }}
              disabled={submitting}
            >
              {ex}
            </button>
          ))}
        </div>

        {err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{err}</div>}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => handleSubmit()}
            disabled={submitting || !text.trim()}
          >
            <SparklesIcon size={16} />
            <span>{submitting ? 'AI 转换中…' : '发送给 AI 自动转换为清单配置'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
