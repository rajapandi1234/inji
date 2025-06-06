package io.mosip.residentapp;


import static io.mosip.openID4VP.authorizationResponse.AuthorizationResponseUtilsKt.toJsonString;
import static io.mosip.openID4VP.constants.FormatType.LDP_VC;
import static io.mosip.openID4VP.constants.FormatType.MSO_MDOC;

import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableMapKeySetIterator;
import com.google.gson.FieldNamingPolicy;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

import io.mosip.openID4VP.OpenID4VP;
import io.mosip.openID4VP.authorizationRequest.AuthorizationRequest;
import io.mosip.openID4VP.authorizationRequest.VPFormatSupported;
import io.mosip.openID4VP.authorizationRequest.Verifier;
import io.mosip.openID4VP.authorizationRequest.WalletMetadata;
import io.mosip.openID4VP.authorizationResponse.unsignedVPToken.UnsignedVPToken;
import io.mosip.openID4VP.authorizationResponse.vpTokenSigningResult.VPTokenSigningResult;
import io.mosip.openID4VP.authorizationResponse.vpTokenSigningResult.types.ldp.LdpVPTokenSigningResult;
import io.mosip.openID4VP.authorizationResponse.vpTokenSigningResult.types.mdoc.DeviceAuthentication;
import io.mosip.openID4VP.authorizationResponse.vpTokenSigningResult.types.mdoc.MdocVPTokenSigningResult;
import io.mosip.openID4VP.constants.FormatType;

public class InjiOpenID4VPModule extends ReactContextBaseJavaModule {
    private static final String TAG = "InjiOpenID4VPModule";
    private static final String MODULE_NAME = "InjiOpenID4VP";

    private OpenID4VP openID4VP;
    private Gson gson;

    InjiOpenID4VPModule(@Nullable ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return MODULE_NAME;
    }

    @ReactMethod
    public void init(String appId) {
        Log.d(TAG, "Initializing InjiOpenID4VPModule with " + appId);
        openID4VP = new OpenID4VP(appId);
        gson = new GsonBuilder()
                .setFieldNamingPolicy(FieldNamingPolicy.LOWER_CASE_WITH_UNDERSCORES)
                .disableHtmlEscaping()
                .create();
    }

    @ReactMethod
    public void authenticateVerifier(String urlEncodedAuthorizationRequest,
                                     ReadableArray trustedVerifiers,
                                     ReadableMap walletMetadata,
                                     Boolean shouldValidateClient,
                                     Promise promise) {
        try {
            WalletMetadata walletMetadataObj = parseWalletMetadata(walletMetadata);
            List<Verifier> verifierList = parseVerifiers(trustedVerifiers);

            AuthorizationRequest authRequest = openID4VP.authenticateVerifier(
                    urlEncodedAuthorizationRequest,
                    verifierList,
                    walletMetadataObj,
                    shouldValidateClient);

            String authRequestJson = gson.toJson(authRequest, AuthorizationRequest.class);
            promise.resolve(authRequestJson);
        } catch (Exception e) {
            promise.reject(e);
        }
    }

    @ReactMethod
    public void constructUnsignedVPToken(ReadableMap selectedVCs, Promise promise) {
        try {
            Map<String, Map<FormatType, List<Object>>> selectedVCsMap = parseSelectedVCs(selectedVCs);
            Map<FormatType, UnsignedVPToken> vpTokens = openID4VP.constructUnsignedVPToken(selectedVCsMap);
            promise.resolve(toJsonString(vpTokens));
        } catch (Exception e) {
            promise.reject(e);
        }
    }

    @ReactMethod
    public void shareVerifiablePresentation(ReadableMap vpTokenSigningResultMap, Promise promise) {
        try {
            Map<FormatType, VPTokenSigningResult> authContainer = parseVPTokenSigningResult(vpTokenSigningResultMap);
            String response = openID4VP.shareVerifiablePresentation(authContainer);
            promise.resolve(response);
        } catch (Exception e) {
            promise.reject(e);
        }
    }

    @ReactMethod
    public void sendErrorToVerifier(String errorMessage) {
        openID4VP.sendErrorToVerifier(new Exception(errorMessage));
    }


    private WalletMetadata parseWalletMetadata(ReadableMap walletMetadata) {
        Boolean presentationDefinitionUriSupported = walletMetadata.hasKey("presentation_definition_uri_supported")
                ? walletMetadata.getBoolean("presentation_definition_uri_supported")
                : null;

        Map<String, VPFormatSupported> vpFormatsSupportedMap = new HashMap<>();
        if (walletMetadata.hasKey("vp_formats_supported")) {
            ReadableMap vpFormatsMap = walletMetadata.getMap("vp_formats_supported");
            if (vpFormatsMap != null && vpFormatsMap.hasKey("ldp_vc")) {
                ReadableMap ldpVc = vpFormatsMap.getMap("ldp_vc");
                if (ldpVc != null && ldpVc.hasKey("alg_values_supported")) {
                    ReadableArray ldpVcAlgArray = ldpVc.getArray("alg_values_supported");
                    List<String> algValuesList = ldpVcAlgArray != null
                            ? convertReadableArrayToList(ldpVcAlgArray)
                            : null;
                    vpFormatsSupportedMap.put("ldp_vc", new VPFormatSupported(algValuesList));
                }
            }
        }
        return new WalletMetadata(
                presentationDefinitionUriSupported,
                vpFormatsSupportedMap,
                extractStringListOrNull(walletMetadata, "client_id_schemes_supported"),
                extractStringListOrNull(walletMetadata, "request_object_signing_alg_values_supported"),
                extractStringListOrNull(walletMetadata, "authorization_encryption_alg_values_supported"),
                extractStringListOrNull(walletMetadata, "authorization_encryption_enc_values_supported")
        );
    }

    private List<Verifier> parseVerifiers(ReadableArray verifiersArray) {
        List<Verifier> verifiers = new ArrayList<>();

        for (int i = 0; i < verifiersArray.size(); i++) {
            ReadableMap verifierMap = verifiersArray.getMap(i);
            String clientId = verifierMap.getString("client_id");
            ReadableArray responseUris = verifierMap.getArray("response_uris");
            List<String> responseUriList = convertReadableArrayToList(responseUris);

            verifiers.add(new Verifier(clientId, responseUriList));
        }

        return verifiers;
    }

    private Map<String, Map<FormatType, List<Object>>> parseSelectedVCs(ReadableMap selectedVCs) {
        if (selectedVCs == null) {
            return Collections.emptyMap();
        }
        Map<String, Map<FormatType, List<Object>>> selectedVCsMap = new HashMap<>();
        ReadableMapKeySetIterator iterator = selectedVCs.keySetIterator();
        while (iterator.hasNextKey()) {
            String inputDescriptorId = iterator.nextKey();
            ReadableMap formatMap = selectedVCs.getMap(inputDescriptorId);
            if (formatMap == null) {
                continue;
            }
            Map<FormatType, List<Object>> formatTypeCredentialsMap = new EnumMap<>(FormatType.class);
            ReadableMapKeySetIterator formatIterator = formatMap.keySetIterator();

            while (formatIterator.hasNextKey()) {
                String formatStr = formatIterator.nextKey();
                ReadableArray vcsArray = formatMap.getArray(formatStr);
                if (vcsArray == null) {
                    continue;
                }
                FormatType formatType = getFormatType(formatStr);
                if (formatType != null) {
                    List<Object> vcsList = convertReadableArrayToListOfCredential(formatType, vcsArray);
                    formatTypeCredentialsMap.put(formatType, vcsList);
                }
            }

            if (!formatTypeCredentialsMap.isEmpty()) {
                selectedVCsMap.put(inputDescriptorId, formatTypeCredentialsMap);
            }
        }
        return selectedVCsMap;
    }

    private Map<FormatType, VPTokenSigningResult> parseVPTokenSigningResult(ReadableMap vpTokenSigningResultMap) {
        if (vpTokenSigningResultMap == null) {
            return Collections.emptyMap();
        }
        Map<FormatType, VPTokenSigningResult> formattedMetadata = new EnumMap<>(FormatType.class);
        ReadableMapKeySetIterator iterator = vpTokenSigningResultMap.keySetIterator();
        while (iterator.hasNextKey()) {
            String formatStr = iterator.nextKey();
            ReadableMap metadata = vpTokenSigningResultMap.getMap(formatStr);
            if (metadata == null) {
                continue;
            }
            FormatType formatType = getFormatType(formatStr);
            VPTokenSigningResult vpTokenSigningResult = createVPTokenSigningResult(formatType, metadata);
            if (vpTokenSigningResult != null) {
                formattedMetadata.put(formatType, vpTokenSigningResult);
            }
        }

        return formattedMetadata;
    }

    private VPTokenSigningResult createVPTokenSigningResult(FormatType formatType, ReadableMap metadata) {
        switch (formatType) {
            case LDP_VC: {
                String jws = requireNonNullString(metadata, "jws");
                String signatureAlgorithm = requireNonNullString(metadata, "signatureAlgorithm");
                String publicKey = requireNonNullString(metadata, "publicKey");
                String domain = requireNonNullString(metadata, "domain");
                return new LdpVPTokenSigningResult(jws, signatureAlgorithm, publicKey, domain);
            }
            case MSO_MDOC: {
                Map<String, DeviceAuthentication> signatureData = new HashMap<>();
                ReadableMapKeySetIterator docTypeIterator = metadata.keySetIterator();
                while (docTypeIterator.hasNextKey()) {
                    String docType = docTypeIterator.nextKey();
                    ReadableMap deviceAuthenticationMap = metadata.getMap(docType);
                    if (deviceAuthenticationMap != null) {
                        String signature = requireNonNullString(deviceAuthenticationMap, "signature");
                        String algorithm = requireNonNullString(deviceAuthenticationMap, "mdocAuthenticationAlgorithm");
                        DeviceAuthentication deviceAuthentication = new DeviceAuthentication(
                                signature = signature,
                                algorithm = algorithm
                        );
                        signatureData.put(docType, deviceAuthentication);
                    }
                }
                return new MdocVPTokenSigningResult(signatureData);
            }
            default:
                return null;
        }
    }

    private List<Object> convertReadableArrayToListOfCredential(FormatType formatType, ReadableArray credentialList) {
        switch (formatType) {
            case LDP_VC: {
                List<Object> ldpVcList = new ArrayList<>();
                for (int i = 0; i < credentialList.size(); i++) {
                    ReadableMap credentialMap = credentialList.getMap(i);
                    ldpVcList.add(credentialMap.toHashMap());
                }
                return ldpVcList;
            }
            case MSO_MDOC: {
                List<Object> mdocVcList = new ArrayList<>();
                for (int i = 0; i < credentialList.size(); i++) {
                    String credential = credentialList.getString(i);
                    mdocVcList.add(credential);
                }
                return mdocVcList;

            }
            default:
                return null;
        }
    }

    private FormatType getFormatType(String formatStr) {
        if (LDP_VC.getValue().equals(formatStr)) {
            return LDP_VC;
        } else if (MSO_MDOC.getValue().equals(formatStr)) {
            return MSO_MDOC;
        }
        throw new UnsupportedOperationException("Credential format not supported: " + formatStr);
    }

    private List<String> extractStringListOrNull(ReadableMap readableMap, String key) {
        return Optional.ofNullable(readableMap.getArray(key))
                .map(this::convertReadableArrayToList)
                .filter(list -> !list.isEmpty())
                .orElse(null);
    }

    private List<String> convertReadableArrayToList(ReadableArray readableArray) {
        List<String> list = new ArrayList<>();

        for (int i = 0; i < readableArray.size(); i++) {
            list.add(readableArray.getString(i));
        }

        return list;
    }

    private String requireNonNullString(ReadableMap map, String key) {
        String value = map.getString(key);
        return Objects.requireNonNull(value, key + " cannot be null");
    }
}