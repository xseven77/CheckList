'use client';

import { useEffect, useRef, useState } from 'react';
import { type Checklist as Doc } from '@/lib/types';

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
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setErr('当前浏览器未开放 Web Speech API 接口，建议直接在下方输入框打字，或使用手机输入法的自带语音输入 🎙️');
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
        if (e.error !== 'no-speech') {
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

  // 处理按住讲话 (Touch & Mouse)
  const handleHoldStart = (e: React.SyntheticEvent) => {
    e.preventDefault();
    isHeldRef.current = true;
    startListening();
  };

  const handleHoldEnd = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (isHeldRef.current) {
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
            <span role="img" aria-label="microphone">🎙️</span>
            AI 语音助手
          </h2>
          <button type="button" className="btn sm quiet" onClick={onClose} disabled={submitting}>
            关闭
          </button>
        </div>

        <p className="sub" style={{ margin: '0 0 12px' }}>
          手机端按住下方按钮讲话，松开后核对识别信息，确认后由 AI 自动转换为清单数据结构。
        </p>

        {/* 长按讲话区 */}
        <div className={'voice-record-zone' + (isRecording ? ' recording' : '')}>
          <button
            type="button"
            className={'voice-hold-btn' + (isRecording ? ' active' : '')}
            onTouchStart={handleHoldStart}
            onTouchEnd={handleHoldEnd}
            onTouchCancel={handleHoldEnd}
            onMouseDown={handleHoldStart}
            onMouseUp={handleHoldEnd}
            aria-label={isRecording ? '正在录音，松开结束' : '长按讲话'}
          >
            🎙️
          </button>
          <div className={'voice-hint' + (isRecording ? ' active' : '')}>
            {isRecording ? '松开结束识别…' : '按住讲话 · 松开完成'}
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
            {submitting ? '✨ AI 解析中…' : '✨ 确认识别，让 AI 转换配置'}
          </button>
        </div>
      </div>
    </div>
  );
}
