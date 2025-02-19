import { Router } from "express";
import middlewareHandler from "@middlewares/_middleware";
import control from "@utils/control";
import sanitizeAndValidate from "~/src/validations/_validate";
import customerController from "@controllers/customerController";
import customerValidation from "@validations/customerValidation";
import { loadFileInMemory, uploadFileToS3 } from "@services/fileService";

export const router = Router();

router.get("/", middlewareHandler("auth"), control(customerController.index));
router.get("/:customerId", middlewareHandler("auth"), sanitizeAndValidate(customerValidation.selectedCustomer), control(customerController.selected));
router.post(
    "/",
    middlewareHandler("auth"),
    loadFileInMemory("pelanggan_data_file", customerValidation.customerDataValidation),
    sanitizeAndValidate(customerValidation.createCustomer),
    uploadFileToS3("customerData", "pelanggan_data_file"),
    control(customerController.create)
);
router.put(
    "/:customerId",
    middlewareHandler("auth"),
    loadFileInMemory("pelanggan_data_file"),
    sanitizeAndValidate(customerValidation.updateCustomer),
    uploadFileToS3("customerData", "pelanggan_data_file"),
    control(customerController.update)
);
router.patch(
    "/:customerId",
    middlewareHandler("auth"),
    loadFileInMemory("pelanggan_data_file"),
    sanitizeAndValidate(customerValidation.updateCustomer),
    uploadFileToS3("customerData", "pelanggan_data_file"),
    control(customerController.update)
);
router.delete(
    "/:customerId",
    middlewareHandler("auth"),
    sanitizeAndValidate(customerValidation.destroyCustomer),
    control(customerController.destroy)
);

export default router;
