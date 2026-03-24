// app/lib/alimtalk.server.ts (NHN Cloud API 연동 최종본)

import axios from 'axios';

function normalizeAlimtalkPhoneNumber(raw: string): string {
  return raw.replace(/\D/g, '').trim();
}

function isValidKoreanMobileNumber(phoneNumber: string): boolean {
  return /^01\d{8,9}$/.test(phoneNumber);
}

// .env 파일에서 NHN Cloud 알림톡 관련 비밀 정보를 가져옵니다.
const ALIMTALK_APPKEY = process.env.ALIMTALK_APPKEY;
const ALIMTALK_SECRET_KEY = process.env.ALIMTALK_SECRET_KEY;
const ALIMTALK_SENDER_KEY = process.env.ALIMTALK_SENDER_KEY;
const API_URL = `https://api-alimtalk.cloud.toast.com/alimtalk/v2.3/appkeys/${ALIMTALK_APPKEY}/messages`;

/**
 * 우리 서비스에서 보낼 알림톡의 종류를 정의합니다.
 */
export enum AlimtalkType {
  /** 회원가입 환영 */
  WELCOME = 0,
  /** 스탬프 적립 안내 */
  STAMP_ACQUIRED = 1,
  /** 쿠폰 발급 안내 */
  COUPON_ISSUED = 2,
  PASSWORD_RESET = 3,
}

// 각 알림톡 타입에 필요한 변수들을 TypeScript로 정의하여 실수를 방지합니다.
type AlimtalkPayloads = {
  [AlimtalkType.WELCOME]: { 'link': string };
  [AlimtalkType.STAMP_ACQUIRED]: { '활동명': string; '고객명': string; '현재개수': string; '남은스탬프개수': string; 'link': string };
  [AlimtalkType.COUPON_ISSUED]: { '고객명': string; '쿠폰설명': string; '만료일자': string; 'link': string };
  [AlimtalkType.PASSWORD_RESET]: { '인증번호': string };
};

/**
 * 알림톡 타입에 맞는 템플릿 코드를 반환합니다.
 */
function getTemplateCode(type: AlimtalkType): string {
  switch (type) {
    case AlimtalkType.WELCOME:
      return 'SIGNUP_COMPLETE'; // 👈 실제 카카오에 등록한 코드로 변경
    case AlimtalkType.STAMP_ACQUIRED:
      return 'STAMP_EARNED'; // 👈 실제 카카오에 등록한 코드로 변경
    case AlimtalkType.COUPON_ISSUED:
      return 'COUPON_ISSUED'; // 👈 실제 카카오에 등록한 코드로 변경
    case AlimtalkType.PASSWORD_RESET:
      return 'AUTH_PASSWORD';
    default:
      throw new Error(`Unhandled Alimtalk type: ${type}`);
  }
}

/**
 * 지정된 타입의 카카오 알림톡을 발송합니다.
 * 로컬 개발 환경에서는 콘솔에만 출력됩니다.
 */
export async function sendAlimtalk<T extends AlimtalkType>(
  type: T,
  to: string,
  payload: AlimtalkPayloads[T]
) {
  const templateCode = getTemplateCode(type);
  const normalizedTo = normalizeAlimtalkPhoneNumber(to);

  if (!normalizedTo) {
    throw new Error('알림톡 수신자 전화번호가 비어 있습니다.');
  }

  if (!isValidKoreanMobileNumber(normalizedTo)) {
    throw new Error(`알림톡 수신자 전화번호 형식이 올바르지 않습니다: ${to}`);
  }

  // 로컬 개발 환경에서는 콘솔에만 출력
  if (process.env.NODE_ENV === 'development') {
    console.log('--- [DEV MODE] KAKAO ALIMTALK (NHN Cloud) ---');
    console.log(`To: ${normalizedTo}`);
    console.log(`Template Code: ${templateCode}`);
    console.log('Payload:', payload);
    console.log('-------------------------------------------');
    return;
  }

  // --- 실제 서버 환경에서만 아래 로직 실행 ---
  if (!ALIMTALK_APPKEY || !ALIMTALK_SECRET_KEY || !ALIMTALK_SENDER_KEY) {
    throw new Error("알림톡 환경 변수가 설정되지 않아 발송할 수 없습니다.");
  }

  const requestBody = {
    senderKey: ALIMTALK_SENDER_KEY,
    templateCode: templateCode,
    recipientList: [
      {
        recipientNo: normalizedTo,
        templateParameter: payload, // 페이로드 객체를 그대로 전달
      },
    ],
  };

  try {
    const response = await axios.post(API_URL, requestBody, {
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Secret-Key': ALIMTALK_SECRET_KEY,
      },
    });

    if (response.data?.header?.isSuccessful) {
      console.log(`알림톡 발송 성공: ${normalizedTo}, 타입: ${AlimtalkType[type]}`);
    } else {
      const resultCode = response.data?.header?.resultCode ?? "UNKNOWN";
      const resultMessage = response.data?.header?.resultMessage ?? "알 수 없는 오류";
      const recipientFailureDetail =
        response.data?.body?.data?.failedList?.[0]?.resultMessage ||
        response.data?.body?.data?.failResults?.[0]?.resultMessage ||
        response.data?.body?.failedList?.[0]?.resultMessage ||
        response.data?.body?.failResults?.[0]?.resultMessage ||
        null;

      const detailSuffix = recipientFailureDetail ? ` / 수신자 사유: ${recipientFailureDetail}` : '';
      throw new Error(`알림톡 발송 실패 (${resultCode}): ${resultMessage}${detailSuffix}`);
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const apiMessage =
        error.response?.data?.header?.resultMessage ||
        error.response?.data?.header?.errorMessage ||
        error.message;
      throw new Error(`알림톡 API 요청 실패: ${apiMessage}`);
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("알림톡 API 요청 중 알 수 없는 오류가 발생했습니다.");
  }
}
