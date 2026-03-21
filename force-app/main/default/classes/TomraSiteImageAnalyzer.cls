public with sharing class TomraSiteImageAnalyzer {

    private static final String PROMPT_TEMPLATE_NAME = 'Site_Image_AI_Analyzer';
    private static final String APPLICATION_NAME = 'PromptTemplateGenerationsInvocable';

    private static final String INPUT_IMAGE_1 = 'Input:Image1';
    private static final String INPUT_IMAGE_2 = 'Input:Image2';
    private static final String INPUT_IMAGE_3 = 'Input:Image3';
    private static final String INPUT_SITE_DETAILS = 'Input:SiteDetails';

    public class AnalyzerException extends Exception {}

    @AuraEnabled
    public static String runAnalysis(
        String fileId1,
        String fileId2,
        String fileId3,
        String measurementsJSON
    ) {
        try {
            validateInputs(fileId1, fileId2, fileId3, measurementsJSON);

            Map<String, ConnectApi.WrappedValue> inputValues =
                buildInputValues(fileId1, fileId2, fileId3, measurementsJSON);

            System.debug(LoggingLevel.DEBUG, 'TomraSiteImageAnalyzer input keys: ' + inputValues.keySet());

            ConnectApi.EinsteinPromptTemplateGenerationsInput promptInput =
                new ConnectApi.EinsteinPromptTemplateGenerationsInput();
            promptInput.isPreview = false;
            promptInput.inputParams = inputValues;
            promptInput.additionalConfig = new ConnectApi.EinsteinLlmAdditionalConfigInput();
            promptInput.additionalConfig.applicationName = APPLICATION_NAME;

            ConnectApi.EinsteinPromptTemplateGenerationsRepresentation result =
                ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate(
                    PROMPT_TEMPLATE_NAME,
                    promptInput
                );

            return extractGeneratedText(result);

        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'TomraSiteImageAnalyzer Exception: ' + e.getMessage());
            System.debug(LoggingLevel.ERROR, 'TomraSiteImageAnalyzer StackTrace: ' + e.getStackTraceString());
            return 'Error: ' + e.getMessage();
        }
    }

    private static Map<String, ConnectApi.WrappedValue> buildInputValues(
        String fileId1,
        String fileId2,
        String fileId3,
        String measurementsJSON
    ) {
        Map<String, ConnectApi.WrappedValue> inputValues =
            new Map<String, ConnectApi.WrappedValue>();

        addFileInputIfPresent(inputValues, INPUT_IMAGE_1, fileId1);
        addFileInputIfPresent(inputValues, INPUT_IMAGE_2, fileId2);
        addFileInputIfPresent(inputValues, INPUT_IMAGE_3, fileId3);

        if (!String.isBlank(measurementsJSON)) {
            inputValues.put(INPUT_SITE_DETAILS, wrapString(measurementsJSON));
        }

        return inputValues;
    }

    private static void addFileInputIfPresent(
        Map<String, ConnectApi.WrappedValue> inputValues,
        String inputKey,
        String fileId
    ) {
        if (!String.isBlank(fileId)) {
            inputValues.put(inputKey, wrapFileId(fileId.trim()));
        }
    }

    private static void validateInputs(
        String fileId1,
        String fileId2,
        String fileId3,
        String measurementsJSON
    ) {
        Boolean hasAtLeastOneImage =
            !String.isBlank(fileId1) ||
            !String.isBlank(fileId2) ||
            !String.isBlank(fileId3);

        Boolean hasSiteDetails = !String.isBlank(measurementsJSON);

        if (!hasAtLeastOneImage && !hasSiteDetails) {
            throw new AnalyzerException('Provide at least one image or site details for analysis.');
        }
    }

    private static ConnectApi.WrappedValue wrapFileId(String fileId) {
        ConnectApi.WrappedValue wrappedValue = new ConnectApi.WrappedValue();
        wrappedValue.value = new Map<String, String>{ 'id' => fileId };
        return wrappedValue;
    }

    private static ConnectApi.WrappedValue wrapString(String value) {
        ConnectApi.WrappedValue wrappedValue = new ConnectApi.WrappedValue();
        wrappedValue.value = value;
        return wrappedValue;
    }

    private static String extractGeneratedText(
        ConnectApi.EinsteinPromptTemplateGenerationsRepresentation result
    ) {
        if (result == null) {
            throw new AnalyzerException('No response was returned by Einstein.');
        }

        if (result.generations == null || result.generations.isEmpty()) {
            throw new AnalyzerException('Einstein did not return any analysis.');
        }

        String output = result.generations[0].text;

        if (String.isBlank(output)) {
            throw new AnalyzerException('Einstein returned an empty analysis.');
        }

        return output.trim();
    }
}