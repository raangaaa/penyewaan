import jwt from "jsonwebtoken";
import env from "~/configs/env";
import errorAPI from "@utils/errorAPI";

const generateAccessToken = (userData: Record<string, string | number>) => {
    const expiresIn = env.ACCESS_TOKEN_EXPIRATION_MINUTES * 60;
    return jwt.sign(userData, env.JWT_TOKEN_SECRET_PRIVATE, {
        algorithm: "RS256",
        expiresIn
    });
};

const verifyAccessToken = async (accessToken: string) => {
    try {
        return jwt.verify(accessToken, env.JWT_TOKEN_SECRET_PUBLIC, {
            algorithms: ["RS256"]
        });
    } catch (err) {
        if (err instanceof Error) {
            if (err.name === "TokenExpiredError") {
                throw new errorAPI("Unauthorized", 401, ["Access expired"]);
            } else if (err.name === "JsonWebTokenError") {
                throw new errorAPI("Unauthorized", 401, ["Access is invalid"]);
            }
            throw err;
        }

        throw err;
    }
};

const generateRefreshToken = (userData: Record<string, string | number>) => {
    const expiresIn = 60 * 60 * 24 * env.REFRESH_TOKEN_EXPIRATION_DAYS;
    return jwt.sign(userData, env.JWT_TOKEN_SECRET_PRIVATE, {
        algorithm: "RS256",
        expiresIn
    });
};

const verifyRefreshToken = async (refreshToken: string) => {
    try {
        return jwt.verify(refreshToken, env.JWT_TOKEN_SECRET_PUBLIC, {
            algorithms: ["RS256"]
        });
    } catch (err) {
        if (err instanceof Error) {
            if (err.name === "TokenExpiredError") {
                throw new errorAPI("Unauthorized", 401, ["Refresh token expired"]);
            } else if (err.name === "JsonWebTokenError") {
                throw new errorAPI("Unauthorized", 401, ["Refresh token is invalid"]);
            }
            throw err;
        }

        throw err;
    }
};

export default {
    generateAccessToken,
    verifyAccessToken,
    generateRefreshToken,
    verifyRefreshToken
};
