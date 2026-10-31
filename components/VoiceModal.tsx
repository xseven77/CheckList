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
  '8号下午 答谢宴，准备伴手礼30份、提前订包厢、结清酒水',
  '在3号增加明细：通知伴郎伴娘提早半小时到',
  '把开场视频标记为已完成',
  '6号下午加一个婚礼彩排，带上捧花和誓词卡',
];

export default function VoiceModal({ isOpen, onClose, onApplyAI, showToast }: VoiceModalProps) {
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const recognitionRef = useRef<any>(null);
  const isHeldRef = useRef(false);

  // 快捷关闭 (ESC)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, submitting, onClose]);

  // 停止并清理录音实例
  const stopListening = () => {
    isHeldRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setIsRecording(false);
  };

  const startListening = () => {
    setErr('');
    const SpeechRecognition =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (!SpeechRecognition) {
      setErr(
        '手机浏览器在非 HTTPS 局域网下按安全规范未开放麦克风权限。💡 建议直接点击下方输入框，使用手机输入法键盘自带的语音输入键（如微信键盘/苹果听写），100% 顺畅识别！'
      );
      return;
    }

    try {
      if (recognitionRef.current) {
        stopListening();
      }
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'zh-CN';

      rec.onstart = () => {
        setIsRecording(true);
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try {
            navigator.vibrate(40);
          } catch {}
        }
      };

      rec.onresult = (event: any) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript.trim()) {
          setText(transcript.trim());
        }
      };

      rec.onerror = (e: any) => {
        setIsRecording(false);
        if (e.error === 'network') {
          setErr(
            '浏览器语音识别连接超时（Chrome 自带语音引擎依赖 Google 服务）。💡 推荐直接点击下方输入框，用手机输入法键盘自带的语音键口述，非常快且准！'
          );
        } else if (e.error === 'not-allowed') {
          setErr('麦克风权限未开启或被系统拦截。请在浏览器设置中允许麦克风权限，或直接使用输入法键盘语音输入。');
        } else if (e.error !== 'no-speech') {
          setErr(`麦克风识别提示（${e.error}），您也可以直接在下方输入修改。`);
        }
      };

      rec.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = rec;
      rec.start();
    } catch (e: any) {
      setIsRecording(false);
      setErr(e?.message || '启动录音失败，请检查浏览器麦克风权限');
    }
  };

  // 点击切换或按住录音双支持
  const toggleListening = () => {
    if (isRecording) {
      stopListening();
    } else {
      startListening();
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    // 记录按下时间
    isHeldRef.current = true;
    if (!isRecording) {
      startListening();
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    // 如果长按松开则结束
    if (isHeldRef.current && isRecording) {
      stopListening();
    }
  };


  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const prompt = text.trim();
    if (!prompt) {
      setErr('请先长按讲话录入，或在下方输入指令内容');
      return;
    }
    setSubmitting(true);
    setErr('');
    showToast('AI 正在理解并转换项目数据结构…', 'info', undefined, 2000);

    try {
      const res = await onApplyAI(prompt);
      showToast(res.summary || 'AI 智能解析成功，已体现到清单！', 'success', undefined, 4000);
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'AI 解析失败，请检查网络或重新表达');
      showToast('AI 解析失败，请重试', 'err');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="AI 语音助手">
      <div className="voice-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="voice-modal-header">
          <h2>
            <MicIcon size={22} className="voice-header-icon" />
            AI 语音助手
          </h2>
          <button type="button" className="btn sm quiet" onClick={onClose} disabled={submitting}>
            关闭
          </button>
        </div>

        <p className="sub" style={{ margin: '0 0 12px' }}>
          手机端按住下方按钮讲话，松开后核对识别信息，确认后由 AI 自动转换为清单数据结构。
        </p>

        {/* 录音讲话区 */}
        <div className={'voice-record-zone' + (isRecording ? ' recording' : '')}>
          <button
            type="button"
            className={'voice-hold-btn' + (isRecording ? ' active' : '')}
            onClick={toggleListening}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            aria-label={isRecording ? '正在录音，点击或松开结束' : '点击或按住开始讲话'}
          >
            <MicIcon size={32} />
          </button>
          <div className={'voice-hint' + (isRecording ? ' active' : '')}>
            {isRecording ? '正在聆听…点击或松开结束' : '点击开始讲话 · 也可按住不放'}
          </div>
          {isRecording && (
            <div className="voice-waves" aria-hidden="true">
              <span className="voice-wave" />
              <span className="voice-wave" />
              <span className="voice-wave" />
              <span className="voice-wave" />
              <span className="voice-wave" />
            </div>
          )}
        </div>

        {/* 局域网/手机端温馨提示 */}
        <div
          style={{
            fontSize: '12.5px',
            color: 'var(--muted)',
            background: 'color-mix(in srgb, var(--gold) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--gold) 25%, transparent)',
            borderRadius: '10px',
            padding: '8px 12px',
            marginBottom: '12px',
            lineHeight: '1.5',
          }}
        >
          💡 <b>手机端建议：</b>局域网非 HTTPS 环境下手机浏览器限制网页麦克风，最推荐直接点击下方输入框，使用<b>手机键盘自带的语音键（如微信键盘/苹果听写）</b>直接口述，识别率极高！
        </div>


        {/* 确认识别文本与手动编辑 */}
        <div className="voice-textarea-wrap">
          <label htmlFor="voice-result-input">识别内容确认（可直接在此修改调整）：</label>
          <textarea
            id="voice-result-input"
            className="voice-textarea"
            rows={3}
            placeholder="长按上方按钮讲话，或直接在此输入（如：8号下午加一个答谢宴，准备伴手礼30份、提前订包厢）"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={submitting}
          />
        </div>

        {/* 快捷示例 */}
        <div className="voice-chips-label">你可以试试点击以下常见口语指令：</div>
        <div className="voice-chips">
          {PRESET_EXAMPLES.map((ex, i) => (
            <button
              key={i}
              type="button"
              className="voice-chip"
              onClick={() => {
                setText(ex);
                setErr('');
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
            <span>{submitting ? 'AI 解析中…' : '确认识别，让 AI 转换配置'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
