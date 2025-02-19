import { logger } from "@utils/logger";
import errorAPI from "@utils/errorAPI";
import { Request, Response } from "express";
import prisma from "~/src/database/prisma";
import dayjs from "dayjs";
import { checkNaN } from "../utils/checkNaN";
import { Prisma, status_kembali, status_pembayaran } from "@prisma/client";

const index = async (req: Request, res: Response) => {
    const { page, search, min_totalharga, max_totalharga, stts_pembayaran, stts_pengembalian, min_sewa, max_sewa, min_kembali, max_kembali } =
        req.query;
    const limit = 25;
    const keywords = Array.isArray(search)
        ? search.map((item) => (typeof item === "string" ? item : undefined)).filter((e) => String(e).trim())
        : typeof search === "string"
          ? [search]
          : undefined;

    try {
        const resultNumberQuery = checkNaN({ min_totalharga, max_totalharga });
        const whereClause: Prisma.penyewaanWhereInput = {
            ...(keywords
                ? {
                      OR: keywords.flatMap((keyword) => [{ pelanggan: { pelanggan_email: { contains: keyword, mode: "insensitive" } } }])
                  }
                : {}),
            ...(resultNumberQuery.min_totalharga ? { penyewaan_totalharga: { gte: Number(min_totalharga) } } : {}),
            ...(resultNumberQuery.max_totalharga ? { penyewaan_totalharga: { lte: Number(max_totalharga) } } : {}),
            ...(stts_pembayaran && stts_pembayaran !== ""
                ? { penyewaan_sttspembayaran: stts_pembayaran.toString().toUpperCase() as status_pembayaran }
                : {}),
            ...(stts_pengembalian && stts_pengembalian !== ""
                ? { penyewaan_sttskembali: stts_pengembalian.toString().toUpperCase() as status_kembali }
                : {}),
            ...(min_sewa ? { penyewaan_tglsewa: { gte: dayjs(min_sewa.toString()).toDate() } } : {}),
            ...(max_sewa ? { penyewaan_tglsewa: { lte: dayjs(max_sewa.toString()).toDate() } } : {}),
            ...(min_kembali ? { penyewaan_tglkembali: { gte: dayjs(min_kembali.toString()).toDate() } } : {}),
            ...(max_kembali ? { penyewaan_tglkembali: { lte: dayjs(max_kembali.toString()).toDate() } } : {})
        };
        const rentals = await prisma.penyewaan.findMany({
            where: whereClause,
            include: {
                _count: true,
                pelanggan: {
                    select: {
                        pelanggan_id: true,
                        pelanggan_nama: true,
                        pelanggan_email: true
                    }
                }
            },
            take: limit,
            skip: typeof page === "string" ? Number(page) * limit - limit : 0
        });

        const totalRentals = await prisma.penyewaan.count({
            where: {
                OR: keywords?.flatMap((keyword) => [
                    { pelanggan: { pelanggan_nama: { contains: keyword, mode: "insensitive" } } },
                    { pelanggan: { pelanggan_email: { contains: keyword, mode: "insensitive" } } }
                ])
            }
        });

        return res.status(200).json({
            success: true,
            message: "Success mendpatkan semua penyewaan",
            data: rentals,
            pagination: {
                item: rentals.length,
                matchData: totalRentals,
                allPage: Math.ceil(totalRentals / limit),
                currentPage: Number(page) || 1
            }
        });
    } catch (err) {
        logger.error("Error during fetching all rentals" + err);
        throw err;
    }
};

const selected = async (req: Request, res: Response) => {
    const { rentalId } = req.params;

    try {
        const resultNumberParams = checkNaN({ rentalId });

        const rental = await prisma.penyewaan.findUnique({
            where: {
                penyewaan_id: resultNumberParams.rentalId
            },
            include: {
                penyewaan_detail: {
                    include: {
                        alat: {
                            include: {
                                kategori: {
                                    include: {
                                        _count: true
                                    }
                                }
                            }
                        }
                    }
                },
                pelanggan: {
                    include: {
                        pelanggan_data: true
                    }
                },
                _count: true
            }
        });

        if (!rental) throw new errorAPI("Penyewaan tidak ditemukan", 404);

        return res.status(200).json({
            success: true,
            message: "Success mendapatkan penyewaan",
            data: rental
        });
    } catch (err) {
        logger.error("Error during fetching selected rental" + err);
        throw err;
    }
};

const create = async (req: Request, res: Response) => {
    const { daftar_alat, penyewaan_pelanggan_id, penyewaan_tglkembali, ...rentalData } = req.body;
    const rentalDate = dayjs().toISOString();
    const rentalReturnDate = dayjs(penyewaan_tglkembali).toISOString();
    const diffInDays = Math.ceil(Math.max(dayjs(rentalReturnDate).diff(dayjs(rentalDate), "day", true), 1));

    try {
        const resultNumberParams = checkNaN({ penyewaan_pelanggan_id });

        const result = await prisma.$transaction(async (tx) => {
            const newRental = await tx.penyewaan.create({
                data: {
                    penyewaan_tglsewa: rentalDate,
                    penyewaan_totalharga: 0,
                    penyewaan_tglkembali: rentalReturnDate,
                    ...resultNumberParams,
                    ...rentalData
                }
            });

            if (!Array.isArray(daftar_alat) || daftar_alat.length === 0) {
                return newRental;
            }

            const toolIds = daftar_alat.map((item) => Number(item.alat_id));
            const tools = await tx.alat.findMany({
                where: { alat_id: { in: toolIds } }
            });

            const toolStockMap = new Map(tools.map((tool) => [tool.alat_id, tool.alat_stok]));

            const isStockEnough = daftar_alat.every((item) => {
                const availableStock = toolStockMap.get(item.alat_id) ?? 0;
                return item.jumlah <= availableStock;
            });

            if (!isStockEnough) {
                throw new errorAPI("Validation error", 400, {
                    penyewaan_detail_alat_id: [`Beberapa alat tidak mencukupi stok`]
                });
            }

            const rentalDetail = await Promise.all(
                daftar_alat.map(async (item) => {
                    const tool = tools.find((tool) => tool.alat_id === Number(item.alat_id));
                    const subharga = tool ? tool.alat_hargaperhari * Number(item.jumlah) * diffInDays : 0;

                    if (tool) {
                        await tx.alat.update({
                            where: { alat_id: tool.alat_id },
                            data: {
                                alat_stok: { decrement: Number(item.jumlah) }
                            }
                        });
                    }

                    return {
                        penyewaan_detail_penyewaan_id: newRental.penyewaan_id,
                        penyewaan_detail_alat_id: Number(item.alat_id),
                        penyewaan_detail_jumlah: Number(item.jumlah),
                        penyewaan_detail_subharga: subharga
                    };
                })
            );

            const totalHarga = rentalDetail.reduce((sum, item) => sum + item.penyewaan_detail_subharga, 0);

            await tx.penyewaan_detail.createMany({ data: rentalDetail });

            return await tx.penyewaan.update({
                where: { penyewaan_id: newRental.penyewaan_id },
                data: { penyewaan_totalharga: totalHarga },
                include: {
                    _count: true,
                    pelanggan: {
                        select: {
                            pelanggan_id: true,
                            pelanggan_nama: true,
                            pelanggan_email: true
                        }
                    }
                }
            });
        });

        return res.status(201).json({
            success: true,
            message: "Success membuat penyewaan baru",
            data: result
        });
    } catch (err) {
        logger.error("Error during creating newRental: " + err);

        if (err instanceof Prisma.PrismaClientKnownRequestError) {
            if (err.code === "P2025") {
                throw new errorAPI("Penyewaan atau alat tidak ditemukan", 404);
            }
        }

        throw err;
    }
};

const update = async (req: Request, res: Response) => {
    const { rentalId } = req.params;
    const { daftar_alat, penyewaan_tglkembali, ...rentalData } = req.body;

    try {
        const resultNumberParams = checkNaN({ rentalId });

        const result = await prisma.$transaction(async (tx) => {
            const existingRental = await tx.penyewaan.findUnique({
                where: { penyewaan_id: resultNumberParams.rentalId }
            });

            if (!existingRental) throw new errorAPI("Penyewaan tidak ditemukan", 404);
            if (dayjs(dayjs(penyewaan_tglkembali).toISOString()).diff(dayjs(existingRental.penyewaan_tglsewa), "day") < 0) {
                throw new errorAPI("Validation error", 400, { penyewaan_tglkembali: ["Tanggal kembali harus diatas tanggal sekarang"] });
            }

            let totalHarga = 0;

            if (Array.isArray(daftar_alat) && daftar_alat.length > 0) {
                const rentalDetails = await tx.penyewaan_detail.findMany({
                    where: { penyewaan_detail_penyewaan_id: resultNumberParams.rentalId }
                });

                const updateQueries = rentalDetails.map((item) =>
                    tx.alat.update({
                        where: { alat_id: item.penyewaan_detail_alat_id },
                        data: { alat_stok: { increment: item.penyewaan_detail_jumlah } }
                    })
                );

                await Promise.all(updateQueries);

                await tx.penyewaan_detail.deleteMany({
                    where: { penyewaan_detail_penyewaan_id: resultNumberParams.rentalId }
                });

                const toolIds = daftar_alat.map((item) => Number(item.alat_id));
                const tools = await tx.alat.findMany({
                    where: { alat_id: { in: toolIds } }
                });

                const toolStockMap = new Map(tools.map((tool) => [tool.alat_id, tool.alat_stok]));

                const isStockEnough = daftar_alat.every((item) => {
                    const availableStock = toolStockMap.get(item.alat_id) ?? 0;
                    return item.jumlah <= availableStock;
                });

                if (!isStockEnough) {
                    throw new errorAPI("Validation error", 400, {
                        penyewaan_detail_alat_id: [`Beberapa alat tidak mencukupi stok`]
                    });
                }

                const diffInDays = Math.ceil(
                    Math.max(
                        dayjs(dayjs(penyewaan_tglkembali).toISOString() || existingRental.penyewaan_tglkembali).diff(
                            dayjs(existingRental.penyewaan_tglsewa),
                            "day",
                            true
                        ),
                        1
                    )
                );

                const rentalDetail = await Promise.all(
                    daftar_alat.map(async (item) => {
                        const tool = tools.find((tool) => tool.alat_id === Number(item.alat_id));
                        const subharga = tool ? tool.alat_hargaperhari * Number(item.jumlah) * diffInDays : 0;
                        totalHarga += subharga;

                        if (tool) {
                            await tx.alat.update({
                                where: { alat_id: tool.alat_id },
                                data: {
                                    alat_stok: { decrement: Number(item.jumlah) }
                                }
                            });
                        }

                        return {
                            penyewaan_detail_penyewaan_id: resultNumberParams.rentalId,
                            penyewaan_detail_alat_id: Number(item.alat_id),
                            penyewaan_detail_jumlah: Number(item.jumlah),
                            penyewaan_detail_subharga: subharga
                        };
                    })
                );

                await tx.penyewaan_detail.createMany({ data: rentalDetail });
            } else {
                if (penyewaan_tglkembali) {
                    const diffInDaysNew = Math.ceil(
                        Math.max(dayjs(dayjs(penyewaan_tglkembali).toISOString()).diff(dayjs(existingRental.penyewaan_tglsewa), "day", true), 1)
                    );
                    const diffInDaysOld = Math.ceil(
                        Math.max(dayjs(existingRental.penyewaan_tglkembali).diff(dayjs(existingRental.penyewaan_tglsewa), "day", true), 1)
                    );

                    await tx.penyewaan_detail.updateMany({
                        where: { penyewaan_detail_penyewaan_id: resultNumberParams.rentalId },
                        data: { penyewaan_detail_subharga: { divide: diffInDaysOld } }
                    });

                    const rentalDetailsNew = await tx.penyewaan_detail.updateManyAndReturn({
                        where: { penyewaan_detail_penyewaan_id: resultNumberParams.rentalId },
                        data: { penyewaan_detail_subharga: { multiply: diffInDaysNew } }
                    });

                    rentalDetailsNew.forEach((item) => {
                        totalHarga += item.penyewaan_detail_subharga;
                    });
                } else {
                    totalHarga = existingRental.penyewaan_totalharga;
                }
            }

            return await tx.penyewaan.update({
                where: { penyewaan_id: resultNumberParams.rentalId },
                data: {
                    ...(penyewaan_tglkembali !== undefined && {
                        penyewaan_tglkembali: dayjs(penyewaan_tglkembali).toISOString()
                    }),
                    penyewaan_totalharga: totalHarga,
                    ...rentalData
                },
                include: {
                    _count: true,
                    pelanggan: {
                        select: {
                            pelanggan_id: true,
                            pelanggan_nama: true,
                            pelanggan_email: true
                        }
                    }
                }
            });
        });

        return res.status(200).json({
            success: true,
            message: "Success mengupdate penyewaan",
            data: result
        });
    } catch (err) {
        logger.error("Error during updating rental: " + err);

        if (err instanceof Prisma.PrismaClientKnownRequestError) {
            if (err.code === "P2025") {
                throw new errorAPI("Penyewaan atau alat tidak ditemukan", 404);
            }
        }

        throw err;
    }
};

const destroy = async (req: Request, res: Response) => {
    const { rentalId } = req.params;
    try {
        const resultNumberParams = checkNaN({ rentalId });

        const rental = await prisma.penyewaan.findUnique({
            where: { penyewaan_id: resultNumberParams.rentalId }
        });

        if (!rental) {
            throw new errorAPI("Penyewaan tidak ditemukan", 404);
        }

        await prisma.$transaction(async (tx) => {
            const rentalDetails = await tx.penyewaan_detail.findMany({
                where: { penyewaan_detail_penyewaan_id: resultNumberParams.rentalId }
            });

            const updateQueries = rentalDetails.map((item) =>
                tx.alat.update({
                    where: { alat_id: item.penyewaan_detail_alat_id },
                    data: { alat_stok: { increment: item.penyewaan_detail_jumlah } }
                })
            );

            await Promise.all(updateQueries);

            await tx.penyewaan_detail.deleteMany({
                where: { penyewaan_detail_penyewaan_id: resultNumberParams.rentalId }
            });

            await tx.penyewaan.delete({
                where: {
                    penyewaan_id: resultNumberParams.rentalId
                }
            });
        });

        return res.status(204).send();
    } catch (err) {
        logger.error("Error during deleting alat: " + err);
        throw err;
    }
};

const destroyNotRestoreToolsStock = async (req: Request, res: Response) => {
    const { rentalId } = req.params;
    try {
        const resultNumberParams = checkNaN({ rentalId });

        const rental = await prisma.penyewaan.findUnique({
            where: { penyewaan_id: resultNumberParams.rentalId }
        });

        if (!rental) {
            throw new errorAPI("Penyewaan tidak ditemukan", 404);
        }

        await prisma.penyewaan.delete({
            where: {
                penyewaan_id: resultNumberParams.rentalId
            }
        });

        return res.status(204).send();
    } catch (err) {
        logger.error("Error during deleting alat: " + err);
        throw err;
    }
};

const clear = async (req: Request, res: Response) => {
    const { rentalId } = req.params;
    try {
        const resultNumberParams = checkNaN({ rentalId });

        const result = await prisma.$transaction(async (tx) => {
            const clearRental = await tx.penyewaan.update({
                where: {
                    penyewaan_id: resultNumberParams.rentalId
                },
                data: {
                    penyewaan_sttspembayaran: "LUNAS",
                    penyewaan_sttskembali: "SUDAH_KEMBALI"
                },
                include: { penyewaan_detail: true }
            });

            const updateQueries = clearRental.penyewaan_detail.map((item) =>
                tx.alat.update({
                    where: { alat_id: item.penyewaan_detail_alat_id },
                    data: { alat_stok: { increment: item.penyewaan_detail_jumlah } }
                })
            );

            await Promise.all(updateQueries);
        });

        return res.status(200).json({
            success: true,
            message: "Penyewaan selesai",
            data: result
        });
    } catch (err) {
        logger.error("Error during deleting alat: " + err);

        if (err instanceof Prisma.PrismaClientKnownRequestError) {
            if (err.code === "P2025") {
                throw new errorAPI("Penyewaan tidak ditemukan", 404);
            }
        }

        throw err;
    }
};

export default { index, selected, create, update, destroy, destroyNotRestoreToolsStock, clear };
