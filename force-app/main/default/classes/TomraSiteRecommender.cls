public with sharing class TomraSiteRecommender {
    
    
    public static String runRecommendation(String Phase_1_AI_Analysis, String Available_Product_Catalog, String Customer_Configuration_Selections) {
        try {
            // Prepare input for the Einstein Prompt Template
            ConnectApi.EinsteinPromptTemplateGenerationsInput promptInput = new ConnectApi.EinsteinPromptTemplateGenerationsInput();
            promptInput.isPreview = false;

            ConnectApi.WrappedValue cWrapped1 = new ConnectApi.WrappedValue();
            cWrapped1.value = Phase_1_AI_Analysis;

            ConnectApi.WrappedValue cWrapped2 = new ConnectApi.WrappedValue();
            cWrapped2.value = Available_Product_Catalog;

            ConnectApi.WrappedValue cWrapped3 = new ConnectApi.WrappedValue();
            cWrapped3.value = Customer_Configuration_Selections;

            // Input values for the prompt
            Map<String, ConnectApi.WrappedValue> inputValues = new Map<String, ConnectApi.WrappedValue>();
            inputValues.put('Input:Phase_1_AI_Analysis', cWrapped1);
            inputValues.put('Input:Available_Product_Catalog', cWrapped2);
            inputValues.put('Input:Customer_Configuration_Selections', cWrapped3);

            promptInput.inputParams = inputValues;
            promptInput.additionalConfig = new ConnectApi.EinsteinLlmAdditionalConfigInput();
            promptInput.additionalConfig.applicationName = 'PromptTemplateGenerationsInvocable';

            // Call Einstein LLM with the prompt template
            ConnectApi.EinsteinPromptTemplateGenerationsRepresentation result = 
                ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate('Site_Product_Recommendation', promptInput);

            System.debug(result.generations[0].text);
            
            return result.generations[0].text;

        } catch (Exception e) {
            System.debug('Error calling Einstein: ' + e.getMessage());
            return 'Error: ' + e.getMessage();
        }
    }
}