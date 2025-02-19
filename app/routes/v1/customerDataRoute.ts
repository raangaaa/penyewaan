import { Router } from "express";
import customerDataController from "~/src/controllers/customerDataController";
import middlewareHandler from "~/src/middlewares/_middleware";
import { loadFileInMemory, uploadFileToS3 } from "~/src/services/fileService";
import control from "~/src/utils/control";
import sanitizeAndValidate from "~/src/validations/_validate";
import customerDataValidation from "~/src/validations/customerDataValidation";

const router = Router();

router.get("/", middlewareHandler("auth"), control(customerDataController.index));
router.get(
    "/:customerDataId",
    middlewareHandler("auth"),
    sanitizeAndValidate(customerDataValidation.selectedCustomerData),
    control(customerDataController.selected)
);
router.post(
    "/",
    middlewareHandler("auth"),
    loadFileInMemory("pelanggan_data_file", customerDataValidation.customerDataValidation),
    sanitizeAndValidate(customerDataValidation.createCustomerData),
    uploadFileToS3("customerData", "pelanggan_data_file"),
    control(customerDataController.create)
);
router.put(
    "/:customerDataId",
    middlewareHandler("auth"),
    loadFileInMemory("pelanggan_data_file"),
    sanitizeAndValidate(customerDataValidation.updateCustomerData),
    uploadFileToS3("customerData", "pelanggan_data_file"),
    control(customerDataController.update)
);
router.patch(
    "/:customerDataId",
    middlewareHandler("auth"),
    loadFileInMemory("pelanggan_data_file"),
    sanitizeAndValidate(customerDataValidation.updateCustomerData),
    uploadFileToS3("customerData", "pelanggan_data_file"),
    control(customerDataController.update)
);
router.delete(
    "/:customerDataId",
    middlewareHandler("auth"),
    sanitizeAndValidate(customerDataValidation.destroyCustomerData),
    control(customerDataController.destroy)
);

export default router;
