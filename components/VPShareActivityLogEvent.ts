import {formatDistanceToNow} from 'date-fns';
import {ActivityLog} from './ActivityLogEvent';
import * as DateFnsLocale from 'date-fns/locale';
import {VCItemContainerFlowType, VCShareFlowType} from '../shared/Utils';
import {TFunction} from 'react-i18next';

export type VPActivityLogType =
  | '' // replacement for undefined
  | 'SHARED_SUCCESSFULLY'
  | 'SHARED_WITH_FACE_VERIFIACTION'
  | 'VERIFIER_AUTHENTICATION_FAILED'
  | 'INVALID_AUTH_REQUEST'
  | 'USER_DECLINED_CONSENT'
  | 'SHARED_AFTER_RETRY'
  | 'SHARED_WITH_FACE_VERIFICATION_AFTER_RETRY'
  | 'RETRY_ATTEMPT_FAILED'
  | 'MAX_RETRY_ATTEMPT_FAILED'
  | 'FACE_VERIFICATION_FAILED'
  | 'FACE_VERIFICATION_FAILED_AFTER_RETRY_ATTEMPT'
  | 'NO_SELECTED_VC_HAS_IMAGE'
  | 'CREDENTIAL_MISMATCH_FROM_KEBAB'
  | 'NO_CREDENTIAL_MATCHING_REQUEST'
  | 'TECHNICAL_ERROR';

export class VPShareActivityLog implements ActivityLog {
  timestamp: number;
  type: VPActivityLogType;
  flow: string;
  info: string;

  constructor({
    type = '' as VPActivityLogType,
    timestamp = Date.now(),
    flow = VCItemContainerFlowType.VP_SHARE,
    info = '',
  }) {
    this.type = type;
    this.timestamp = timestamp;
    this.flow = flow;
    this.info = info;
  }

  getActionText(t: TFunction) {
    return `${t('ActivityLogText:vpSharing:' + this.type, {info: this.info})}`;
  }

  static getLogFromObject(data: Object): VPShareActivityLog {
    return new VPShareActivityLog(data);
  }

  getActionLabel(language: string) {
    return [
      formatDistanceToNow(this.timestamp, {
        addSuffix: true,
        locale: DateFnsLocale[language],
      }),
    ]
      .filter(label => label?.trim() !== '')
      .join(' · ');
  }
}
