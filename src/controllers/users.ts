import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import sgMail from '@sendgrid/mail';
import { validationResult } from 'express-validator';

import HttpError from '../models/http-error';
import User, { UserInterface } from '../models/user';
import { confirmRegistration } from '../shared/emails';
import {
    invalidInputs,
    failedSignup,
    userExists,
    failedLogin,
    invalidUser,
    invalidPassword,
} from '../shared/SSOT/ErrorMessages/user';
import { RequestBodyHandler } from '../shared/types/requests';
import { CustomToken } from '../shared/types/token';

interface PostSignupBody {
    email: string;
    password: string;
}

interface PostLoginBody {
    email: string;
    password: string;
}

interface PostActivationBody {
    token: string;
}

interface ActivationToken {
    userId: string;
}

export const postSignup: RequestBodyHandler<PostSignupBody> = async (req, res, next) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return next(new HttpError(invalidInputs, 422));
    }

    const { email, password } = req.body;

    const userExist: UserInterface = await User.findOne({ email }).catch(() =>
        next(new HttpError(failedSignup, 500)),
    );

    if (userExist) {
        return next(new HttpError(userExists, 422));
    }

    const hashedPassword = await bcrypt
        .hash(password, 12)
        .catch(() => next(new HttpError(failedSignup, 500)));

    const createdUser = new User({
        email,
        password: hashedPassword,
    });

    await createdUser.save().catch(() => next(new HttpError(failedSignup, 500)));

    const token = jwt.sign({ userId: createdUser.id }, process.env.JWT_SECURITY!, {
        expiresIn: '2h',
    });

    await sgMail
        .send(confirmRegistration({ to: createdUser.email, token }))
        .catch((error) => next(new HttpError(failedSignup, 500)));

    res.status(201).json({});
};

export const postLogin: RequestBodyHandler<PostLoginBody> = async (req, res, next) => {
    const { email, password } = req.body;

    const userExist: UserInterface = await User.findOne({ email }).catch(() =>
        next(new HttpError(failedLogin, 500)),
    );

    if (!userExist) {
        return next(new HttpError(invalidUser, 403));
    }

    const isValidPassword = await bcrypt
        .compare(password, userExist.password)
        .catch(() => next(new HttpError(failedLogin, 500)));

    if (!isValidPassword) {
        return next(new HttpError(invalidPassword, 401));
    }

    const token = jwt.sign(
        { userId: userExist.id, email: userExist.email },
        process.env.JWT_SECURITY!,
        { expiresIn: '1h' },
    );

    res.json({ userId: userExist.id, email: userExist.email, token });
};

export const postActivation: RequestBodyHandler<PostActivationBody> = async (req, res, next) => {
    const { token } = req.body;

    let verifyToken;
    try {
        verifyToken = jwt.verify(token, process.env.JWT_SECURITY!) as CustomToken<ActivationToken>;
    } catch (error) {
        return next(new HttpError(invalidPassword, 401));
    }

    if (verifyToken.exp * 1000 < Date.now()) {
        return next(new HttpError(invalidPassword, 401));
    }
    res.status(201).json({ message: 'Account activated!' });
};
