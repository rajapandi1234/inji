import base64url from 'base64url';
import i18next from 'i18next';
import jwtDecode from 'jwt-decode';
import jose from 'node-jose';
import {NativeModules} from 'react-native';
import {vcVerificationBannerDetails} from '../../components/BannerNotificationContainer';
import {VCProcessor} from '../../components/VC/common/VCProcessor';
import {
  BOTTOM_SECTION_FIELDS_WITH_DETAILED_ADDRESS_FIELDS,
  DETAIL_VIEW_ADD_ON_FIELDS,
  getCredentialTypeFromWellKnown,
} from '../../components/VC/common/VCUtils';
import i18n from '../../i18n';
import {displayType, issuerType} from '../../machines/Issuers/IssuersMachine';
import {
  Credential,
  CredentialTypes,
  CredentialWrapper,
  VerifiableCredential,
} from '../../machines/VerifiableCredential/VCMetaMachine/vc';
import getAllConfigurations, {CACHED_API} from '../api';
import {isAndroid, isIOS} from '../constants';
import {getJWT} from '../cryptoutil/cryptoUtil';
import {isMockVC} from '../Utils';
import {
  VerificationErrorMessage,
  VerificationErrorType,
  verifyCredential,
} from '../vcjs/verifyCredential';
import {getVerifiableCredential} from '../../machines/VerifiableCredential/VCItemMachine/VCItemSelectors';
import {getErrorEventData, sendErrorEvent} from '../telemetry/TelemetryUtils';
import {TelemetryConstants} from '../telemetry/TelemetryConstants';
import {KeyTypes} from '../cryptoutil/KeyTypes';
import {VCFormat} from '../VCFormat';
import {UnsupportedVcFormat} from '../error/UnsupportedVCFormat';
import {VCMetadata} from '../VCMetadata';
import {UUID} from '../Utils';

export const Protocols = {
  OpenId4VCI: 'OpenId4VCI',
  OTP: 'OTP',
};

export const Issuers = {
  MosipOtp: '',
  Mosip: 'Mosip',
};

export function getVcVerificationDetails(
  statusType,
  vcMetadata: VCMetadata,
  verifiableCredential,
  wellknown: Object,
): vcVerificationBannerDetails {
  const credentialType = getCredentialTypeFromWellKnown(
    wellknown,
    getVerifiableCredential(verifiableCredential).credentialConfigurationId,
  );
  return {
    statusType: statusType,
    vcType: credentialType,
  };
}

export const ACTIVATION_NEEDED = [Issuers.Mosip, Issuers.MosipOtp];

export const isActivationNeeded = (issuer: string) => {
  return ACTIVATION_NEEDED.indexOf(issuer) !== -1;
};

export const Issuers_Key_Ref = 'OpenId4VCI_KeyPair';

export const updateCredentialInformation = async (
  context,
  credential: VerifiableCredential,
): Promise<CredentialWrapper> => {
  let processedCredential;
  if (context.selectedCredentialType.format === VCFormat.mso_mdoc) {
    processedCredential = await VCProcessor.processForRendering(
      credential,
      context.selectedCredentialType.format,
    );
  }
  const verifiableCredential = {
    ...credential,
    credentialConfigurationId: context.selectedCredentialType.id,
    issuerLogo: getDisplayObjectForCurrentLanguage(
      context.selectedIssuer.display,
    )?.logo,
    processedCredential,
  };
  return {
    verifiableCredential,
    format: context.selectedCredentialType.format,
    generatedOn: new Date(),
    vcMetadata: {
      ...context.vcMetadata,
      format: context.selectedCredentialType.format,
    },
  };
};

export const getDisplayObjectForCurrentLanguage = (
  display: [displayType],
): displayType => {
  const currentLanguage = i18next.language;
  const languageKey = Object.keys(display[0]).includes('language')
    ? 'language'
    : 'locale';
  let displayType = display.filter(
    obj => obj[languageKey] == currentLanguage,
  )[0];
  if (!displayType) {
    displayType = display.filter(obj => obj[languageKey] === 'en')[0];
  }
  return displayType;
};

export const constructAuthorizationConfiguration = (
  selectedIssuer: issuerType,
  supportedScope: string,
) => {
  return {
    issuer: selectedIssuer.issuer_id,
    clientId: selectedIssuer.client_id,
    scopes: [supportedScope],
    redirectUrl: selectedIssuer.redirect_uri,
    additionalParameters: {ui_locales: i18n.language},
    serviceConfiguration: {
      authorizationEndpoint: selectedIssuer.authorizationEndpoint,
      tokenEndpoint: selectedIssuer.token_endpoint,
    },
  };
};

export const getCredentialIssuersWellKnownConfig = async (
  issuer: string | undefined,
  defaultFields: string[],
  credentialConfigurationId: string,
  format: string,
  issuerHost: string,
) => {
  let fields: string[] = defaultFields;
  let matchingWellknownDetails: any;
  const wellknownResponse = await CACHED_API.fetchIssuerWellknownConfig(
    issuer!,
    issuerHost,
    true,
  );
  try {
    if (wellknownResponse) {
      matchingWellknownDetails = getMatchingCredentialIssuerMetadata(
        wellknownResponse,
        credentialConfigurationId,
      );
      if (
        matchingWellknownDetails.order != null &&
        matchingWellknownDetails.order.length > 0
      ) {
        fields = matchingWellknownDetails.order;
      } else {
        if (format === VCFormat.mso_mdoc) {
          fields = [];
          Object.keys(matchingWellknownDetails.claims).forEach(namespace => {
            Object.keys(matchingWellknownDetails.claims[namespace]).forEach(
              claim => {
                fields.concat(`${namespace}~${claim}`);
              },
            );
          });
        } else if (format === VCFormat.ldp_vc) {
          fields = Object.keys(
            matchingWellknownDetails.credential_definition.credentialSubject,
          );
        } else {
          console.error(`Unsupported credential format - ${format} found`);
          throw new UnsupportedVcFormat(format);
        }
      }
    }
  } catch (error) {
    console.error(
      `Error occurred while parsing well-known response of credential type - ${credentialConfigurationId} so returning default fields only. Error is `,
      error.toString(),
    );
    return {
      matchingCredentialIssuerMetadata: matchingWellknownDetails,
      fields: fields,
    };
  }
  return {
    matchingCredentialIssuerMetadata: matchingWellknownDetails,
    wellknownResponse,
    fields: fields,
  };
};

export const getDetailedViewFields = async (
  issuer: string,
  credentialConfigurationId: string,
  defaultFields: string[],
  format: string,
  issuerHost: string,
) => {
  let response = await getCredentialIssuersWellKnownConfig(
    issuer,
    defaultFields,
    credentialConfigurationId,
    format,
    issuerHost,
  );

  let updatedFieldsList = response.fields.concat(DETAIL_VIEW_ADD_ON_FIELDS);

  updatedFieldsList = removeBottomSectionFields(updatedFieldsList);

  return {
    matchingCredentialIssuerMetadata: response.matchingCredentialIssuerMetadata,
    fields: updatedFieldsList,
    wellknownResponse: response.wellknownResponse,
  };
};

export const removeBottomSectionFields = fields => {
  return fields.filter(
    fieldName =>
      !BOTTOM_SECTION_FIELDS_WITH_DETAILED_ADDRESS_FIELDS.includes(fieldName) &&
      fieldName !== 'address',
  );
};

export const vcDownloadTimeout = async (): Promise<number> => {
  const response = await getAllConfigurations();

  return Number(response['openId4VCIDownloadVCTimeout']) || 30000;
};

// OIDCErrors is a collection of external errors from the OpenID library or the issuer
export const OIDCErrors = {
  OIDC_FLOW_CANCELLED_ANDROID: 'User cancelled flow',
  OIDC_FLOW_CANCELLED_IOS: 'org.openid.appauth.general error -3',

  INVALID_TOKEN_SPECIFIED: 'Invalid token specified',
  OIDC_CONFIG_ERROR_PREFIX: 'Config error',

  AUTHORIZATION_ENDPOINT_DISCOVERY: {
    GRANT_TYPE_NOT_SUPPORTED: 'Grant type not supported by Wallet',
    FAILED_TO_FETCH_AUTHORIZATION_ENDPOINT: 'Failed to fetch authorization endpoint or grant type not supported by wallet',
  },
};

// ErrorMessage is the type of error message shown in the UI

export enum ErrorMessage {
  NO_INTERNET = 'noInternetConnection',
  GENERIC = 'generic',
  REQUEST_TIMEDOUT = 'technicalDifficulty',
  BIOMETRIC_CANCELLED = 'biometricCancelled',
  TECHNICAL_DIFFICULTIES = 'technicalDifficulty',
  CREDENTIAL_TYPE_DOWNLOAD_FAILURE = 'credentialTypeListDownloadFailure',
  AUTHORIZATION_GRANT_TYPE_NOT_SUPPORTED = 'authorizationGrantTypeNotSupportedByWallet',
}

export async function constructProofJWT(
  publicKey: any,
  privateKey: any,
  accessToken: string,
  selectedIssuer: issuerType,
  keyType: string,
): Promise<string> {
  const jwtHeader = {
    alg: keyType,
    jwk: await getJWK(publicKey, keyType),
    typ: 'openid4vci-proof+jwt',
  };
  const decodedToken = jwtDecode(accessToken);
  const jwtPayload = {
    iss: selectedIssuer.client_id,
    nonce: decodedToken.c_nonce,
    aud: selectedIssuer.credential_audience,
    iat: Math.floor(new Date().getTime() / 1000),
    exp: Math.floor(new Date().getTime() / 1000) + 18000,
  };

  return await getJWT(
    jwtHeader,
    jwtPayload,
    Issuers_Key_Ref,
    privateKey,
    keyType,
  );
}

export const getJWK = async (publicKey, keyType) => {
  try {
    let publicKeyJWK;
    switch (keyType) {
      case KeyTypes.RS256:
        publicKeyJWK = await getJWKRSA(publicKey);
        break;
      case KeyTypes.ES256:
        publicKeyJWK = await getJWKECR1(publicKey);
        break;
      case KeyTypes.ES256K:
        publicKeyJWK = await getJWKECK1(publicKey);
        break;
      case KeyTypes.ED25519:
        publicKeyJWK = await getJWKED(publicKey);
        break;
      default:
        throw Error;
    }
    return {
      ...publicKeyJWK,
      alg: keyType,
      use: 'sig',
    };
  } catch (e) {
    console.error(
      'Exception occurred while constructing JWK from PEM : ' +
        publicKey +
        '  Exception is ',
      e,
    );
  }
};
async function getJWKRSA(publicKey): Promise<any> {
  const publicKeyJWKString = await jose.JWK.asKey(publicKey, 'pem');
  return publicKeyJWKString.toJSON();
}
async function getJWKECR1(publicKey): Promise<any> {
  let jwk = {};
  if (isAndroid()) {
    const publicKeyJWKString = await jose.JWK.asKey(publicKey, 'pem');
    jwk = publicKeyJWKString.toJSON();
  } else {
    const x = base64url(Buffer.from(publicKey.slice(1, 33))); // Skip the first byte (0x04) in the uncompressed public key
    const y = base64url(Buffer.from(publicKey.slice(33, 65)));
    jwk = {
      kty: 'EC',
      crv: 'P-256',
      x: x,
      y: y,
    };
  }

  return jwk;
}
function getJWKECK1(publicKey): any {
  const x = base64url(Buffer.from(publicKey.slice(1, 33))); // Skip the first byte (0x04) in the uncompressed public key
  const y = base64url(Buffer.from(publicKey.slice(33)));
  const jwk = {
    kty: 'EC',
    crv: 'secp256k1',
    x: x,
    y: y,
  };
  return jwk;
}
function getJWKED(publicKey): any {
  const x = base64url(publicKey);
  const jwk = {
    kty: 'OKP',
    crv: 'Ed25519',
    x: x,
  };
  return jwk;
}
export async function hasKeyPair(keyType: any): Promise<boolean> {
  const {RNSecureKeystoreModule} = NativeModules;
  try {
    return await RNSecureKeystoreModule.hasAlias(keyType);
  } catch (e) {
    console.error('key not found');
    return false;
  }
}

export function selectCredentialRequestKey(
  keyTypes: string[],
  keyOrder: object,
) {
  const lowerCaseKeyTypes = keyTypes.map(key => key.toLowerCase());

  for (const index in keyOrder) {
    if (lowerCaseKeyTypes.includes(keyOrder[index].toLowerCase())) {
      return keyOrder[index];
    }
  }
  return '';
}

export const constructIssuerMetaData = (
  selectedIssuer: issuerType,
  selectedCredentialType: CredentialTypes,
  downloadTimeout: Number,
): Object => {
  const issuerMeta: Object = {
    credentialAudience: selectedIssuer.credential_audience,
    credentialEndpoint: selectedIssuer.credential_endpoint,
    downloadTimeoutInMilliSeconds: downloadTimeout,
    credentialFormat: selectedCredentialType.format,
  };
  if (selectedCredentialType.format === VCFormat.ldp_vc) {
    issuerMeta['credentialType'] = selectedCredentialType?.credential_definition
      ?.type ?? ['VerifiableCredential'];
  } else if (selectedCredentialType.format === VCFormat.mso_mdoc) {
    issuerMeta['doctype'] = selectedCredentialType.doctype;
    issuerMeta['claims'] = selectedCredentialType.claims;
  }
  return issuerMeta;
};

export function getMatchingCredentialIssuerMetadata(
  wellknown: any,
  credentialConfigurationId: string,
): any {
  for (const credentialTypeKey in wellknown.credential_configurations_supported) {
    if (credentialTypeKey === credentialConfigurationId) {
      return wellknown.credential_configurations_supported[credentialTypeKey];
    }
  }
  console.error(
    'Selected credential type is not available in wellknown config supported credentials list',
  );
  sendErrorEvent(
    getErrorEventData(
      TelemetryConstants.FlowType.wellknownConfig,
      TelemetryConstants.ErrorId.mismatch,
      TelemetryConstants.ErrorMessage.wellknownConfigMismatch,
    ),
  );
  throw new Error(
    `Selected credential type - ${credentialConfigurationId} is not available in wellknown config supported credentials list`,
  );
}

export async function verifyCredentialData(
  credential: Credential,
  credentialFormat: string,
  issuerId: string,
) {
  if (credentialFormat === VCFormat.mso_mdoc || !isMockVC(issuerId)) {
    const verificationResult = await verifyCredential(
      credential,
      credentialFormat,
    );
    return verificationResult;
  } else {
    return {
      isVerified: true,
      verificationMessage: VerificationErrorMessage.NO_ERROR,
      verificationErrorCode: VerificationErrorType.NO_ERROR,
    };
  }
}
